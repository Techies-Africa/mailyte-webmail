'use client';

import { useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { WebmailFolder, WebmailListItem } from '@/components/webmail/types';
import type { ListParams } from './listParams';
import type { FolderDeltas, ListPage } from './messageCache';

/**
 * Actions on messages that the person has taken and the server has not yet
 * confirmed.
 *
 * They are not written into the query cache while pending. They sit here and
 * are laid over whatever the cache holds at render time, so:
 *
 * - the screen changes in the same frame as the click;
 * - Undo, or a failed request, just drops the action -- the cache was never
 *   touched, so there is nothing to restore and nothing to get wrong when two
 *   actions overlap;
 * - a list fetched while an action is pending (a poll, a folder visit) still
 *   shows the action applied.
 *
 * Only once the server says yes is the result written into the cache itself.
 */

export type RemoveReason =
  | 'archive'
  | 'trash'
  | 'move'
  | 'spam'
  | 'notSpam'
  | 'deleteForever'
  | 'cancelScheduled'
  | 'discardDraft';

export interface FlagPatch {
  isRead?: boolean;
  isStarred?: boolean;
  addLabels?: string[];
  removeLabels?: string[];
}

interface OpBase {
  opId: number;
  ids: string[];
  idSet: ReadonlySet<string>;
  /**
   * held: waiting out its Undo window, nothing sent yet.
   * running: sent, not answered.
   * settled: confirmed and written to the cache; kept a few seconds so a
   *   list fetch that left before the write cannot paint the old flags back.
   */
  state: 'held' | 'running' | 'settled';
  /** What each message contributes to the rail's counts, by folder. */
  deltasById: ReadonlyMap<string, FolderDeltas>;
}

/** The messages leave where they are: moved, trashed, deleted, sent back to Drafts. */
export interface RemoveOp extends OpBase {
  kind: 'remove';
  reason: RemoveReason;
  /** Where they go; null when they stop existing. */
  dest: string | null;
}

export interface FlagsOp extends OpBase {
  kind: 'flags';
  patch: FlagPatch;
}

/** Everything in one folder becomes read ("mark all read"); the ids are not known up front. */
export interface FolderReadOp extends OpBase {
  kind: 'folderRead';
  folder: string;
}

export type PendingOp = RemoveOp | FlagsOp | FolderReadOp;

export type NewOp =
  | Omit<RemoveOp, 'opId' | 'state' | 'idSet'>
  | Omit<FlagsOp, 'opId' | 'state' | 'idSet'>
  | Omit<FolderReadOp, 'opId' | 'state' | 'idSet'>;

export interface OpsSnapshot {
  ops: readonly PendingOp[];
  /**
   * Ids that are gone for good. A message id is FOLDER:UID, and IMAP never
   * reuses a UID within a folder's uid_validity, so once a move or delete is
   * confirmed its old id can be filtered out of anything, however late that
   * thing was fetched.
   */
  tombstones: ReadonlySet<string>;
}

/** How long a confirmed flag change keeps being laid over late-arriving lists. */
const SETTLED_TTL_MS = 15_000;

export class OpsStore {
  private snapshot: OpsSnapshot = { ops: [], tombstones: new Set() };
  private readonly listeners = new Set<() => void>();
  private readonly idleListeners = new Set<() => void>();
  private nextId = 1;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  /** Held or running: something on screen is ahead of the server. */
  get busy(): boolean {
    return this.snapshot.ops.some((op) => op.state !== 'settled');
  }

  /** Run `listener` each time the last unconfirmed action is answered. */
  onIdle(listener: () => void): () => void {
    this.idleListeners.add(listener);
    return () => {
      this.idleListeners.delete(listener);
    };
  }

  private set(next: OpsSnapshot) {
    const wasBusy = this.busy;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
    if (wasBusy && !this.busy) for (const listener of this.idleListeners) listener();
  }

  add(op: NewOp, state: 'held' | 'running'): PendingOp {
    const full = { ...op, opId: this.nextId++, state, idSet: new Set(op.ids) } as PendingOp;
    this.set({ ...this.snapshot, ops: [...this.snapshot.ops, full] });
    return full;
  }

  get(opId: number): PendingOp | undefined {
    return this.snapshot.ops.find((op) => op.opId === opId);
  }

  setState(opId: number, state: PendingOp['state']) {
    this.set({
      ...this.snapshot,
      ops: this.snapshot.ops.map((op) => (op.opId === opId ? { ...op, state } : op)),
    });
    if (state === 'settled') setTimeout(() => this.drop(opId), SETTLED_TTL_MS);
  }

  /** Keep only these ids: the rest failed and go back to how the server has them. */
  narrow(opId: number, keep: Iterable<string>) {
    const kept = new Set(keep);
    this.set({
      ...this.snapshot,
      ops: this.snapshot.ops.map((op) => {
        if (op.opId !== opId) return op;
        const ids = op.ids.filter((id) => kept.has(id));
        const deltasById = new Map([...op.deltasById].filter(([id]) => kept.has(id)));
        return { ...op, ids, idSet: new Set(ids), deltasById };
      }),
    });
  }

  drop(opId: number) {
    if (!this.get(opId)) return;
    this.set({ ...this.snapshot, ops: this.snapshot.ops.filter((op) => op.opId !== opId) });
  }

  tombstone(ids: Iterable<string>) {
    const tombstones = new Set(this.snapshot.tombstones);
    for (const id of ids) tombstones.add(id);
    this.set({ ...this.snapshot, tombstones });
  }

  /** A folder's ids were reissued (uid_validity changed): its old tombstones mean nothing now. */
  forgetTombstones(folders: Iterable<string>) {
    const prefixes = [...folders].map((f) => `${f}:`);
    const tombstones = new Set([...this.snapshot.tombstones].filter((id) => !prefixes.some((p) => id.startsWith(p))));
    this.set({ ...this.snapshot, tombstones });
  }

  /** Ops still ahead of the server, oldest first. */
  unsettled(): PendingOp[] {
    return this.snapshot.ops.filter((op) => op.state !== 'settled');
  }
}

const stores = new WeakMap<QueryClient, OpsStore>();

/** The pending actions of this tab's cache. Outlives any one screen. */
export function opsStoreOf(queryClient: QueryClient): OpsStore {
  let store = stores.get(queryClient);
  if (!store) {
    store = new OpsStore();
    stores.set(queryClient, store);
  }
  return store;
}

export function usePendingOps(): OpsSnapshot {
  const store = opsStoreOf(useQueryClient());
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// --- Laying the actions over what the cache holds ------------------------------------

export function applyFlagPatch<T extends WebmailListItem>(row: T, patch: FlagPatch): T {
  let next = row;
  if (patch.isRead !== undefined && next.isRead !== patch.isRead) next = { ...next, isRead: patch.isRead };
  if (patch.isStarred !== undefined && next.isStarred !== patch.isStarred) next = { ...next, isStarred: patch.isStarred };
  if (patch.addLabels?.length || patch.removeLabels?.length) {
    const removes = new Set(patch.removeLabels ?? []);
    const labels = [...new Set([...next.labels.filter((l) => !removes.has(l)), ...(patch.addLabels ?? [])])].sort();
    if (labels.join('\n') !== next.labels.join('\n')) next = { ...next, labels };
  }
  return next;
}

/** A message as it will be once every pending flag change lands. Removals are the caller's business. */
export function overlayMessage<T extends WebmailListItem>(row: T, snapshot: OpsSnapshot): T {
  let next = row;
  for (const op of snapshot.ops) {
    if (op.kind === 'flags' && op.idSet.has(row.id)) next = applyFlagPatch(next, op.patch);
    else if (op.kind === 'folderRead' && op.state !== 'settled' && next.folder === op.folder && !next.isRead) {
      next = { ...next, isRead: true };
    }
  }
  return next;
}

/** Whether a pending removal takes a message out of this list. */
function removalHides(op: RemoveOp, params: ListParams): boolean {
  if (op.reason === 'archive' || op.reason === 'move' || op.reason === 'notSpam') {
    // A folder list loses it. A cross-folder list -- a label view, a search of
    // all mail -- still holds it, now in its new folder.
    return params.folder !== null && params.folder !== op.dest;
  }
  // Trash, Junk, gone, or back to Drafts: out of every view.
  return true;
}

export function overlayPage(page: ListPage | undefined, params: ListParams, snapshot: OpsSnapshot): ListPage | undefined {
  if (!page || (snapshot.ops.length === 0 && snapshot.tombstones.size === 0)) return page;

  let hidden = 0;
  let changed = false;
  const items: WebmailListItem[] = [];
  for (const item of page.items) {
    if (snapshot.tombstones.has(item.id)) {
      hidden++;
      continue;
    }
    let row = item;
    let gone = false;
    for (const op of snapshot.ops) {
      if (op.kind !== 'remove' || op.state === 'settled' || !op.idSet.has(row.id)) continue;
      if (removalHides(op, params)) {
        gone = true;
        break;
      }
      if (op.dest && row.folder !== op.dest) row = { ...row, folder: op.dest };
    }
    if (!gone) {
      row = overlayMessage(row, snapshot);
      // Membership: an unstarred message leaves Starred, a message that lost
      // a label leaves that label's view. A message marked read stays in the
      // Unread filter until the next visit, so it does not jump from under
      // the pointer.
      if ((params.starred && !row.isStarred) || (params.label !== null && !row.labels.includes(params.label))) {
        gone = true;
      }
    }
    if (gone) {
      hidden++;
      continue;
    }
    if (row !== item) changed = true;
    items.push(row);
  }

  if (hidden === 0 && !changed) return page;
  return { ...page, items, total: Math.max(0, page.total - hidden) };
}

/** The rail's counts, moved by every action the server has not confirmed yet. */
export function overlayFolders(folders: WebmailFolder[], snapshot: OpsSnapshot): WebmailFolder[] {
  const totals = new Map<string, { unread: number; total: number }>();
  for (const op of snapshot.ops) {
    if (op.state === 'settled') continue;
    for (const deltas of op.deltasById.values()) {
      for (const [folder, delta] of deltas) {
        const current = totals.get(folder) ?? { unread: 0, total: 0 };
        totals.set(folder, { unread: current.unread + delta.unread, total: current.total + delta.total });
      }
    }
  }
  if (totals.size === 0) return folders;
  return folders.map((f) => {
    const delta = totals.get(f.name);
    if (!delta) return f;
    return {
      ...f,
      unreadEmails: Math.max(0, f.unreadEmails + delta.unread),
      totalEmails: Math.max(0, f.totalEmails + delta.total),
    };
  });
}
