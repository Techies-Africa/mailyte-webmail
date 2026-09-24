import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { WebmailFolder, WebmailListItem, WebmailMessage } from '@/components/webmail/types';
import { qk } from './keys';
import type { ListParams } from './listParams';

/**
 * Writing what the client already knows into every cached copy of it.
 *
 * One message can sit in several cached lists at once -- its folder, Starred,
 * a label view, a search -- as well as in its own body cache and in other
 * messages' conversations. A change made here has to reach all of them, or
 * going back to a view shows the message as it was before.
 */

export interface ListPage {
  items: WebmailListItem[];
  total: number;
  /** The offset this page was fetched at, which a stand-in page keeps showing. */
  offset: number;
}

export function listParamsOf(key: QueryKey): ListParams {
  return key[2] as ListParams;
}

/**
 * Replace cached data without claiming a fetch happened. Keeping the old
 * timestamp keeps "Synced 2 minutes ago" honest, and leaves staleness to the
 * clock rather than to the edit.
 */
function quietSet<T>(queryClient: QueryClient, key: QueryKey, data: T): void {
  queryClient.setQueryData(key, data, { updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt });
}

/** Rewrite every cached list page. Return the same page to leave it untouched. */
export function updateListPages(
  queryClient: QueryClient,
  update: (page: ListPage, params: ListParams) => ListPage,
): void {
  for (const [key, page] of queryClient.getQueriesData<ListPage>({ queryKey: qk.lists })) {
    if (!page) continue;
    const next = update(page, listParamsOf(key));
    if (next !== page) quietSet(queryClient, key, next);
  }
}

/** Apply `patch` to these messages wherever they are cached: lists, bodies, conversations. */
export function patchMessages(
  queryClient: QueryClient,
  ids: Iterable<string>,
  patch: <T extends WebmailListItem>(message: T) => T,
): void {
  const set = new Set(ids);
  if (set.size === 0) return;

  updateListPages(queryClient, (page) => {
    if (!page.items.some((m) => set.has(m.id))) return page;
    return { ...page, items: page.items.map((m) => (set.has(m.id) ? patch(m) : m)) };
  });

  for (const id of set) {
    const key = qk.message(id);
    const message = queryClient.getQueryData<WebmailMessage>(key);
    if (message) quietSet(queryClient, key, patch(message));
  }

  for (const [key, thread] of queryClient.getQueriesData<WebmailListItem[]>({ queryKey: qk.threads })) {
    if (!thread || !thread.some((m) => set.has(m.id))) continue;
    quietSet(queryClient, key, thread.map((m) => (set.has(m.id) ? patch(m) : m)));
  }
}

/**
 * Take these messages out of every cached list page `where` accepts, and
 * count them out of that page's total. Only rows actually on a page are
 * counted: a page that never held the message keeps its total.
 */
export function removeFromLists(
  queryClient: QueryClient,
  ids: Iterable<string>,
  where: (params: ListParams) => boolean = () => true,
): void {
  const set = new Set(ids);
  if (set.size === 0) return;
  updateListPages(queryClient, (page, params) => {
    if (!where(params)) return page;
    const items = page.items.filter((m) => !set.has(m.id));
    if (items.length === page.items.length) return page;
    return { ...page, items, total: Math.max(0, page.total - (page.items.length - items.length)) };
  });
}

/** Drop the body and conversation of messages that no longer exist under these ids. */
export function forgetMessages(queryClient: QueryClient, ids: Iterable<string>): void {
  for (const id of ids) {
    queryClient.removeQueries({ queryKey: qk.message(id), exact: true });
    queryClient.removeQueries({ queryKey: qk.thread(id), exact: true });
  }
}

export type FolderDeltas = Map<string, { unread: number; total: number }>;

export function addDelta(deltas: FolderDeltas, folder: string, unread: number, total: number): void {
  const current = deltas.get(folder) ?? { unread: 0, total: 0 };
  deltas.set(folder, { unread: current.unread + unread, total: current.total + total });
}

/** Move the rail's counts by what the client just did, before the server says so. */
export function adjustFolderCounts(queryClient: QueryClient, deltas: FolderDeltas): void {
  if (deltas.size === 0) return;
  const folders = queryClient.getQueryData<WebmailFolder[]>(qk.folders);
  if (!folders) return;
  quietSet(
    queryClient,
    qk.folders,
    folders.map((f) => {
      const delta = deltas.get(f.name);
      if (!delta) return f;
      return {
        ...f,
        unreadEmails: Math.max(0, f.unreadEmails + delta.unread),
        totalEmails: Math.max(0, f.totalEmails + delta.total),
      };
    }),
  );
}

/** The newest cached copy of a message's row, from any list, or from its open body. */
export function findMessage(queryClient: QueryClient, id: string): WebmailListItem | undefined {
  for (const [, page] of queryClient.getQueriesData<ListPage>({ queryKey: qk.lists })) {
    const found = page?.items.find((m) => m.id === id);
    if (found) return found;
  }
  return queryClient.getQueryData<WebmailMessage>(qk.message(id));
}

/**
 * Mark the lists of these folders stale, plus every cross-folder list (label
 * views, all-mail search), which could hold a message from any of them.
 * Lists on screen refetch now; the rest refetch when next shown.
 */
export function invalidateFolderLists(
  queryClient: QueryClient,
  folders: Iterable<string> | 'all',
  refetchType: 'active' | 'none' = 'active',
): Promise<void> {
  const set = folders === 'all' ? null : new Set(folders);
  return queryClient.invalidateQueries({
    queryKey: qk.lists,
    refetchType,
    predicate: (query) => {
      if (!set) return true;
      const params = listParamsOf(query.queryKey);
      return params.folder === null || set.has(params.folder);
    },
  });
}
