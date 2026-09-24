import type { QueryClient } from '@tanstack/react-query';
import type { WebmailFolder } from '@/components/webmail/types';
import { qk } from './keys';
import { invalidateFolderLists, listParamsOf } from './messageCache';
import { opsStoreOf } from './pendingOps';

/**
 * Delta sync (PRD P4).
 *
 * The folder list is both the rail's data and the change signal: every
 * folder carries IMAP's own change tokens. One cheap poll of it, compared
 * with the last answer, says which folders moved -- and only their lists are
 * fetched again. A folder whose uid_validity changed has had every id in it
 * reissued, so everything cached about it is dropped rather than refreshed.
 *
 * The comparison is always against the last SERVER answer, never the cached
 * one: the cache also carries counts the client adjusted ahead of the server.
 */

interface SyncState {
  baseline: Map<string, WebmailFolder> | null;
  /** The next answer reflects the client's own change: take it as the new baseline and reload nothing. */
  absorbNext: boolean;
  /** Folders that changed while actions were pending, reloaded once the last one is answered. */
  deferred: Set<string>;
}

const states = new WeakMap<QueryClient, SyncState>();

function stateOf(queryClient: QueryClient): SyncState {
  let state = states.get(queryClient);
  if (!state) {
    const created: SyncState = { baseline: null, absorbNext: false, deferred: new Set() };
    opsStoreOf(queryClient).onIdle(() => {
      if (created.deferred.size === 0) return;
      const folders = [...created.deferred];
      created.deferred.clear();
      void invalidateFolderLists(queryClient, folders);
      void queryClient.invalidateQueries({ queryKey: qk.scheduled });
    });
    states.set(queryClient, created);
    state = created;
  }
  return state;
}

/**
 * The next folder answer carries a change this client made itself -- a move,
 * a read flag, a sent message -- whose effect is already on screen.
 */
export function absorbNextFolders(queryClient: QueryClient): void {
  stateOf(queryClient).absorbNext = true;
}

/** Called with every fresh folder list, before it is cached. */
export function onFoldersFetched(queryClient: QueryClient, folders: WebmailFolder[]): void {
  const state = stateOf(queryClient);
  const previous = state.baseline;
  state.baseline = new Map(folders.map((f) => [f.name, f]));

  if (!previous) return;
  if (state.absorbNext) {
    state.absorbNext = false;
    return;
  }

  const changed = new Set<string>();
  const reissued = new Set<string>();
  for (const folder of folders) {
    const before = previous.get(folder.name);
    if (!before) {
      changed.add(folder.name);
    } else if (before.uidValidity !== folder.uidValidity) {
      reissued.add(folder.name);
    } else if (
      before.uidNext !== folder.uidNext ||
      before.totalEmails !== folder.totalEmails ||
      before.unreadEmails !== folder.unreadEmails
    ) {
      changed.add(folder.name);
    }
  }

  if (reissued.size > 0) {
    opsStoreOf(queryClient).forgetTombstones(reissued);
    const prefixes = [...reissued].map((name) => `${name}:`);
    const inReissued = (id: unknown) => typeof id === 'string' && prefixes.some((p) => id.startsWith(p));
    queryClient.removeQueries({ queryKey: qk.messages, predicate: (q) => inReissued(q.queryKey[2]) });
    queryClient.removeQueries({ queryKey: qk.threads, predicate: (q) => inReissued(q.queryKey[2]) });
    void queryClient.resetQueries({
      queryKey: qk.lists,
      predicate: (q) => {
        const folder = listParamsOf(q.queryKey).folder;
        return folder !== null && reissued.has(folder);
      },
    });
  }

  if (changed.size === 0 && reissued.size === 0) return;
  // While an action is still ahead of the server, a reload could briefly
  // show the message where it was. Hold the reload until the queue is quiet.
  if (opsStoreOf(queryClient).busy) {
    for (const name of [...changed, ...reissued]) state.deferred.add(name);
    return;
  }
  void invalidateFolderLists(queryClient, [...changed, ...reissued]);
  void queryClient.invalidateQueries({ queryKey: qk.scheduled });
}
