import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { WebmailDelivery, WebmailFolder, WebmailListItem } from '@/components/webmail/types';
import { toDelivery, toFolder, toListItem, toMessage } from '@/lib/webmail/adapters';
import {
  aiSummarize,
  getMessage,
  getMessageDelivery,
  getThread,
  listFolders,
  listMessages,
} from '@/lib/webmail/client';
import { ApiError, unwrap } from './errors';
import { qk } from './keys';
import { PAGE_SIZE, sameListOtherPage, type ListParams } from './listParams';
import { listParamsOf, type ListPage } from './messageCache';
import { cancelAbsorb, onFoldersFetched } from './mailSync';

/**
 * The mail queries: the folder rail, list pages, message bodies and
 * conversations. Defined once here so the hook that shows them and the code
 * that prefetches them ask for exactly the same thing.
 */

/** How often the folder list is polled for changes while the tab is visible (PRD P4). */
export const POLL_MS = 45_000;

/**
 * The soonest a return to the window checks the folders again. Coming back
 * checks at once, even inside the query's 15 s staleTime (a quick trip to
 * another tab is exactly when a code was just sent), but not twice in a few seconds.
 */
export const RETURN_CHECK_MIN_MS = 5_000;

/**
 * Delivery, opens, clicks and spam score of a sent message.
 *
 * An extra beside the message: no retry (a 404 means the server has no such
 * feature, a 503 will say the same in a second), and the reader shows nothing
 * on any failure. Coming back to the tab asks again, so a message opened a
 * minute ago shows the opens that have arrived since.
 *
 * A message sent seconds ago has no delivery rows yet (the log trails the send)
 * or a recipient still pending. While that is so it asks again every 15 s, at
 * most 12 times (about three minutes), so the panel moves on by itself without
 * ever polling for good a message whose rows never come.
 */
const INFLIGHT_POLL_MS = 15_000;
const INFLIGHT_POLL_LIMIT = 12;

export function deliveryQuery(id: string, onUnauthorized: () => void) {
  return queryOptions({
    queryKey: qk.delivery(id),
    queryFn: async (): Promise<WebmailDelivery | null> => {
      const data = unwrap(await getMessageDelivery(id, onUnauthorized));
      return data ? toDelivery(data) : null;
    },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data;
      const inFlight = !!data && (data.recipients.length === 0 || data.recipients.some((r) => r.status === 'pending'));
      return inFlight && query.state.dataUpdateCount < INFLIGHT_POLL_LIMIT ? INFLIGHT_POLL_MS : false;
    },
  });
}

export function foldersQuery(queryClient: QueryClient, onUnauthorized: () => void) {
  return queryOptions({
    queryKey: qk.folders,
    queryFn: async (): Promise<WebmailFolder[]> => {
      let folders: WebmailFolder[];
      try {
        folders = (unwrap(await listFolders(onUnauthorized)) ?? []).map(toFolder);
      } catch (error) {
        cancelAbsorb(queryClient);
        throw error;
      }
      onFoldersFetched(queryClient, folders);
      return folders;
    },
    staleTime: 15_000,
  });
}

export function listQuery(params: ListParams, onUnauthorized: () => void) {
  return queryOptions({
    queryKey: qk.list(params),
    queryFn: async (): Promise<ListPage> => {
      const page = unwrap(
        await listMessages(
          {
            folder: params.folder,
            search: params.search || undefined,
            offset: params.offset,
            limit: PAGE_SIZE,
            unread: params.unread || undefined,
            starred: params.starred || undefined,
            label: params.label ?? undefined,
            attachments: params.attachments || undefined,
            mentioned: params.mentioned || undefined,
          },
          onUnauthorized,
        ),
      );
      return {
        items: (page?.messages ?? []).map(toListItem),
        total: page?.total ?? 0,
        offset: params.offset,
      };
    },
    // Paging within one list keeps the page on screen until the next one
    // lands. A different list never borrows another's rows.
    placeholderData: (previous, previousQuery) =>
      previous && previousQuery && sameListOtherPage(listParamsOf(previousQuery.queryKey), params)
        ? previous
        : undefined,
  });
}

export function messageQuery(id: string, onUnauthorized: () => void) {
  return queryOptions({
    queryKey: qk.message(id),
    queryFn: async () => {
      // BODY.PEEK on the server: reading a body never marks it read, so
      // fetching one ahead of a click is safe.
      const data = unwrap(await getMessage(id, onUnauthorized));
      if (!data) throw new ApiError('That message could not be loaded.');
      return toMessage(data);
    },
    staleTime: 5 * 60_000,
  });
}

export function threadQuery(id: string, onUnauthorized: () => void) {
  return queryOptions({
    queryKey: qk.thread(id),
    queryFn: async (): Promise<WebmailListItem[]> => {
      const data = unwrap(await getThread(id, onUnauthorized));
      return Array.isArray(data) ? data.map(toListItem) : [];
    },
    staleTime: 60_000,
  });
}

/** An AI summary is expensive and does not change: made once per message, on request. */
export function summaryQuery(id: string, onUnauthorized: () => void) {
  return queryOptions({
    queryKey: qk.summary(id),
    queryFn: async () => {
      const data = unwrap(await aiSummarize(id, onUnauthorized));
      if (!data?.summary) throw new ApiError('Could not summarize this conversation.');
      return data.summary;
    },
    staleTime: Infinity,
    retry: false,
  });
}
