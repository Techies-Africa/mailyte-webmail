import { notifyManager, type QueryClient } from '@tanstack/react-query';
import type { WebmailFolder } from '@/components/webmail/types';
import type { ToastOptions } from '@/components/ui/Toast';
import { discardDraft as apiDiscardDraft } from '@/lib/webmail/client';
import { qk } from './keys';
import { absorbNextFolders } from './mailSync';
import {
  addDelta,
  adjustFolderCounts,
  findMessage,
  forgetMessages,
  invalidateFolderLists,
  removeFromLists,
  updateListPages,
  type FolderDeltas,
} from './messageCache';
import { commitOp, type OpOutcome } from './opRunner';
import { opsStoreOf, overlayMessage, type PendingOp, type RemoveOp, type RemoveReason } from './pendingOps';

/**
 * Settling removals, and the few cache chores around them, as plain functions
 * of the query client -- so work that outlives the inbox (a send finishing on
 * another page, a draft discarded after it) settles exactly as the inbox would.
 */

export type Toast = (text: string, options?: ToastOptions) => number;

/** What these messages of an action move in the rail's counts. */
export function deltasOf(op: PendingOp, ids: Iterable<string>): FolderDeltas {
  const sum: FolderDeltas = new Map();
  for (const id of ids) {
    for (const [folder, delta] of op.deltasById.get(id) ?? []) addDelta(sum, folder, delta.unread, delta.total);
  }
  return sum;
}

/** 401 and 403 already send the person to sign in; a toast on top says nothing more. */
export const isSessionStatus = (status: number | null) => status === 401 || status === 403;

export const REMOVAL_VERB: Record<RemoveReason, string> = {
  archive: 'archive',
  trash: 'move to Trash',
  move: 'move',
  spam: 'move to Junk',
  notSpam: 'move to Inbox',
  deleteForever: 'delete',
  cancelScheduled: 'cancel',
  discardDraft: 'discard',
};

export function failureText(verb: string, failed: number, total: number, error: string | null): string {
  const what = failed === total ? (total === 1 ? 'that message' : `${total} messages`) : `${failed} of ${total} messages`;
  return `Couldn't ${verb} ${what}${error ? `: ${error}` : ''}`;
}

/**
 * Fetch the folder list after the client changed something itself. Its
 * answer carries that change, which is already on screen, so it becomes the
 * new baseline instead of reloading lists. Before the list was ever loaded
 * there is no baseline to protect, and nothing to absorb.
 */
export function refreshFolders(queryClient: QueryClient) {
  if (queryClient.getQueryState(qk.folders)?.data === undefined) return Promise.resolve();
  absorbNextFolders(queryClient);
  return queryClient.refetchQueries({ queryKey: qk.folders, exact: true });
}

export function loadScheduled(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: qk.scheduled });
}

/** A folder's real name by its role, from the cached folder list. */
export function folderNameByRole(queryClient: QueryClient, role: string, fallback: string): string {
  return queryClient.getQueryData<WebmailFolder[]>(qk.folders)?.find((f) => f.role === role)?.name ?? fallback;
}

/**
 * A removal was answered. What the server confirmed is written into the
 * cache for good; what it refused simply reappears, because the pending
 * action is dropped. Then the folders it touched are asked for the truth.
 */
export function settleRemoval(queryClient: QueryClient, toast: Toast, op: RemoveOp, outcome: OpOutcome): void {
  const store = opsStoreOf(queryClient);
  // A move leaves a label view or an all-mail search holding the message
  // under a new id; there it stays, in its new folder, until that list
  // reloads -- rather than vanishing and coming back.
  const movedTo =
    op.dest && (op.reason === 'archive' || op.reason === 'move' || op.reason === 'notSpam') ? op.dest : null;
  const ok = new Set(outcome.ok);

  // One batch: the cache writes and the end of the pending action reach
  // the screen in the same render, so no count or row flickers for a frame.
  notifyManager.batch(() => {
    if (ok.size > 0) {
      if (movedTo) {
        removeFromLists(queryClient, ok, (params) => params.folder !== null);
        updateListPages(queryClient, (page, params) =>
          params.folder === null && page.items.some((m) => ok.has(m.id))
            ? { ...page, items: page.items.map((m) => (ok.has(m.id) ? { ...m, folder: movedTo } : m)) }
            : page,
        );
      } else {
        removeFromLists(queryClient, ok);
      }
      forgetMessages(queryClient, ok);
      adjustFolderCounts(queryClient, deltasOf(op, ok));
    }
    notifyManager.schedule(() => store.settleRemoval(op.opId, ok, movedTo));
  });

  void refreshFolders(queryClient);
  const touched = [...deltasOf(op, ok).keys()];
  // The source list backfills its page; the destination gains the
  // message under its new id; label views and searches pick that id up.
  if (touched.length > 0) void invalidateFolderLists(queryClient, touched);
  if (op.reason === 'cancelScheduled' || op.reason === 'discardDraft') void loadScheduled(queryClient);

  if (op.reason === 'cancelScheduled') {
    // Said only once the server agrees: a send that already went cannot be cancelled.
    if (ok.size > 0) toast('Send cancelled — the message is in your drafts');
    else if (outcome.firstStatus === 404) {
      toast('That message is no longer scheduled — it may already have been sent', { tone: 'warning' });
      void invalidateFolderLists(queryClient, 'all');
    }
  }
  if (
    outcome.failed.length > 0 &&
    op.reason !== 'discardDraft' &&
    !(op.reason === 'cancelScheduled' && outcome.firstStatus === 404) &&
    !isSessionStatus(outcome.firstStatus)
  ) {
    toast(failureText(REMOVAL_VERB[op.reason], outcome.failed.length, op.ids.length, outcome.firstError), {
      tone: 'error',
    });
  }
}

/**
 * Remove a draft that has done its job (its message went), through the same
 * engine as every other removal, with no screen to update but the cache.
 */
export function discardDraftNow(
  queryClient: QueryClient,
  id: string,
  onUnauthorized: () => void,
  toast: Toast,
): void {
  const store = opsStoreOf(queryClient);
  if (store.isInMotion(id)) return;
  const deltasById = new Map<string, FolderDeltas>();
  const cached = findMessage(queryClient, id);
  if (cached) {
    const row = overlayMessage(cached, store.getSnapshot());
    const deltas: FolderDeltas = new Map();
    addDelta(deltas, row.folder, row.isRead ? 0 : -1, -1);
    deltasById.set(id, deltas);
  }
  const op = store.add({ kind: 'remove', reason: 'discardDraft', dest: null, ids: [id], deltasById }, 'running');
  commitOp(
    queryClient,
    op.opId,
    (target) => apiDiscardDraft(target, onUnauthorized),
    (settled, outcome) => settleRemoval(queryClient, toast, settled as RemoveOp, outcome),
  );
}
