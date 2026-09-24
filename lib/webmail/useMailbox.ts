'use client';

/**
 * The mailbox: every piece of state the inbox screen holds and every action
 * it can take, in one hook.
 *
 * This used to live inline in app/page.tsx, at 1,400 lines, next to the
 * markup. The redesign splits the screen into panes with their own
 * components, and they all need the same state -- so the state moved here
 * and the page became the wiring.
 *
 * What the server says lives in the query cache (lib/webmail/query), not in
 * this hook: every folder, view and page visited stays cached, so going back
 * to one paints at once and refreshes quietly. What the person is doing --
 * which folder, which message, what is selected -- is this hook's own state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/Toast';
import type { ComposeMode, WebmailListItem, WebmailMessage } from '@/components/webmail/types';
import type { ComposePayload } from '@/components/webmail/compose/types';
import {
  listMessages,
  trashMessage as apiTrash,
  deleteForever as apiDeleteForever,
  star as apiStar,
  unstar as apiUnstar,
  moveMessage as apiMove,
  markRead as apiMarkRead,
  markUnread as apiMarkUnread,
  sendMessage as apiSend,
  aiCompose as apiAiCompose,
  saveDraft as apiSaveDraft,
  discardDraft as apiDiscardDraft,
  cancelScheduled as apiCancelScheduled,
  createFolder as apiCreateFolder,
  renameFolder as apiRenameFolder,
  deleteFolder as apiDeleteFolder,
  blockSender as apiBlockSender,
  setLabels as apiSetLabels,
} from '@/lib/webmail/client';
import type { SharedMailbox } from '@/lib/webmail/client';
import { formatSendAt } from '@/lib/webmail/scheduleTimes';
import { FALLBACK_FOLDERS } from '@/lib/webmail/adapters';
import {
  useCapabilities,
  useLabels,
  useScheduled,
  useSettings,
  useSuggestions,
} from '@/lib/webmail/query/accountQueries';
import { qk } from '@/lib/webmail/query/keys';
import {
  PAGE_SIZE,
  STARRED_VIEW,
  labelOfView,
  listParamsFor,
  type ListFilter,
  type SearchScope,
} from '@/lib/webmail/query/listParams';
import { POLL_MS, foldersQuery, listQuery, messageQuery, summaryQuery, threadQuery } from '@/lib/webmail/query/mailQueries';
import { absorbNextFolders } from '@/lib/webmail/query/mailSync';
import {
  adjustFolderCounts,
  findMessage,
  forgetMessages,
  invalidateFolderLists,
  listParamsOf,
  patchMessages,
  removeFromLists,
} from '@/lib/webmail/query/messageCache';
import { useUnauthorizedHandler } from '@/lib/webmail/query/session';
import { isAuthError } from '@/lib/webmail/query/errors';

export { PAGE_SIZE, STARRED_VIEW, LABEL_VIEW_PREFIX, labelOfView } from '@/lib/webmail/query/listParams';
export type { ListFilter, SearchScope } from '@/lib/webmail/query/listParams';

/** The most rows "mark all read" will touch in one go. */
const MARK_ALL_CAP = 1000;

/** Fallback window when the preference has not loaded yet. */
const DEFAULT_UNDO_SECONDS = 5;

export function splitAddresses(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * What the URL is currently describing. The address bar carries folder and
 * open message so a refresh, a shared link and the Back button all land
 * where they say.
 */
function readUrlState(): { folder: string | null; id: string | null } {
  if (typeof window === 'undefined') return { folder: null, id: null };
  const params = new URLSearchParams(window.location.search);
  return { folder: params.get('folder'), id: params.get('id') };
}

/**
 * Native history rather than router.push(): picking a folder or a message is
 * an in-page selection, and re-running the route for it would remount the
 * screen. pushState feeds the address bar and Back without disturbing the
 * tree; the popstate listener restores state.
 */
function pushUrlState(folder: string, id: string | null, replace = false) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  if (folder && folder !== 'INBOX') params.set('folder', folder);
  if (id) params.set('id', id);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  window.history[replace ? 'replaceState' : 'pushState']({ folder, id }, '', url);
}

export interface SendContext {
  mode: ComposeMode;
  replyTo?: WebmailMessage;
  draftId?: string;
}

export interface PendingSend {
  subject: string;
  until: number;
  payload: ComposePayload;
  context: SendContext;
}

const NO_SHARED_MAILBOXES: SharedMailbox[] = [];
const NO_MESSAGES: WebmailListItem[] = [];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function useMailbox() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const handleUnauthorized = useUnauthorizedHandler();

  // --- Mailbox-wide data, shared with every other screen ----------------------------

  const capabilitiesQuery = useCapabilities();
  const settings = useSettings().data ?? null;
  const contacts = useSuggestions();
  const scheduled = useScheduled();
  const labels = useLabels();
  const capabilities = capabilitiesQuery.data?.capabilities ?? null;
  const sharedMailboxes = capabilitiesQuery.data?.shared_mailboxes ?? NO_SHARED_MAILBOXES;

  const aiAvailable = capabilities?.ai === true;
  const scheduleAvailable = capabilities?.scheduled_send === true;
  const calendarAvailable = capabilities?.calendar === true;
  const contactsAvailable = capabilities?.contacts === true;

  // A placeholder only, so the profile chip is not blank on first paint. The
  // authoritative address is the SERVER's, from capabilities -- the only
  // thing that knows whose session this actually is.
  const [placeholderEmail, setPlaceholderEmail] = useState('');
  const displayEmail = capabilitiesQuery.data?.email_address || placeholderEmail;

  // --- What the person is looking at --------------------------------------------------

  const [activeFolder, setActiveFolder] = useState(() => readUrlState().folder ?? 'INBOX');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // `search` is what's typed; `activeSearch` is what the server was asked
  // for. Keeping them apart is what makes search a submit rather than a
  // keystroke-per-request against IMAP.
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('folder');
  const [filter, setFilterState] = useState<ListFilter>('all');
  /** A message that would not open. List failures come from the list query itself. */
  const [openError, setOpenError] = useState<string | null>(null);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);

  // --- Folders: the rail, and the change signal ----------------------------------------

  // Polled while the tab is visible and checked again when it comes back
  // (P4). Only folders whose change tokens moved have their lists reloaded;
  // see mailSync.ts.
  const foldersResult = useQuery({
    ...foldersQuery(queryClient, handleUnauthorized),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const folders = foldersResult.data ?? FALLBACK_FOLDERS;

  const activeFolderMeta = folders.find((f) => f.name === activeFolder) ?? null;
  const inTrash = activeFolderMeta?.role === 'trash';
  const inJunk = activeFolderMeta?.role === 'junk';
  const folderByRole = useCallback(
    (role: string, fallback: string) => folders.find((f) => f.role === role)?.name ?? fallback,
    [folders],
  );
  const draftsFolder = folderByRole('drafts', 'Drafts');
  const sentFolder = folderByRole('sent', 'Sent');

  /**
   * Fetch the folder list after the client changed something itself. Its
   * answer carries that change, which is already on screen, so it becomes the
   * new baseline instead of reloading lists.
   */
  const refreshFolders = useCallback(() => {
    absorbNextFolders(queryClient);
    return queryClient.refetchQueries({ queryKey: qk.folders, exact: true });
  }, [queryClient]);

  // --- The message list ------------------------------------------------------------------

  const listParams = useMemo(
    () => listParamsFor({ folder: activeFolder, search: activeSearch, scope: searchScope, filter, offset }),
    [activeFolder, activeSearch, searchScope, filter, offset],
  );
  const listResult = useQuery(listQuery(listParams, handleUnauthorized));
  const page = listResult.data;
  const messages = page?.items ?? NO_MESSAGES;
  const total = page?.total ?? 0;
  // A page standing in for the next one keeps its own range on screen.
  const shownOffset = page?.offset ?? offset;
  /** Nothing to show for this view yet: the only time the list shows a skeleton. */
  const loadingList = listResult.isPending;
  /** A fetch is running behind what is on screen. */
  const refreshing = listResult.isFetching;
  const isPlaceholderPage = listResult.isPlaceholderData;
  const listError = listResult.isError ? listResult.error.message : null;
  const error = openError ?? listError;

  // Until the first authenticated request comes back, we do not know whether
  // there is a session at all. Rendering the mailbox before then meant a
  // signed-out visitor saw the full interface, then a redirect. A 401 never
  // opens this gate, so the mailbox never paints on the way out to sign-in.
  const sessionChecked =
    listResult.data !== undefined ||
    foldersResult.isSuccess ||
    capabilitiesQuery.isSuccess ||
    // Any other failure is worth showing as one, with Try again.
    (listResult.isError && !isAuthError(listResult.error));

  const syncedAt = Math.max(foldersResult.dataUpdatedAt, listResult.dataUpdatedAt);
  const lastSyncAt = useMemo(() => (syncedAt > 0 ? new Date(syncedAt) : null), [syncedAt]);

  // Scheduled and labels are account-wide queries; after a change, ask them to look again.
  const loadScheduled = useCallback(
    () => queryClient.invalidateQueries({ queryKey: qk.scheduled }),
    [queryClient],
  );
  const loadLabels = useCallback(
    () => queryClient.invalidateQueries({ queryKey: qk.labels }),
    [queryClient],
  );

  useEffect(() => {
    const raw = sessionStorage.getItem('mailyte_mailbox_display');
    if (!raw) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlaceholderEmail(JSON.parse(raw).email_address ?? '');
    } catch {
      // display-only, safe to ignore
    }
  }, []);

  // Remember the server's answer for the next first paint.
  const serverEmail = capabilitiesQuery.data?.email_address;
  useEffect(() => {
    if (!serverEmail) return;
    try {
      sessionStorage.setItem('mailyte_mailbox_display', JSON.stringify({ email_address: serverEmail }));
    } catch {
      // Storage unavailable (private mode); the query is what renders.
    }
  }, [serverEmail]);

  const refreshAll = useCallback(() => {
    // The folder answer is compared as usual, so anything that changed
    // elsewhere is picked up too; the list on screen is fetched regardless.
    void queryClient.refetchQueries({ queryKey: qk.folders, exact: true });
    void queryClient.invalidateQueries({ queryKey: qk.list(listParams), exact: true });
    void loadScheduled();
    setOpenError(null);
  }, [queryClient, listParams, loadScheduled]);

  /** The next page, fetched while the pointer is on "Older". */
  const prefetchNextPage = useCallback(() => {
    if (shownOffset + PAGE_SIZE >= total) return;
    void queryClient.prefetchQuery(listQuery({ ...listParams, offset: shownOffset + PAGE_SIZE }, handleUnauthorized));
  }, [queryClient, listParams, shownOffset, total, handleUnauthorized]);

  // --- Navigation --------------------------------------------------------------

  const setFolder = useCallback((folder: string) => {
    setActiveFolder(folder);
    setSelectedIds([]);
    setOpenId(null);
    setOpenError(null);
    setSearch('');
    setActiveSearch('');
    setFilterState('all');
    setOffset(0);
    pushUrlState(folder, null);
  }, []);

  /** Search runs on the server, in this folder or across every folder (P5). */
  const runSearch = useCallback((query: string, scope?: SearchScope) => {
    if (scope) setSearchScope(scope);
    setActiveSearch(query.trim());
    setOffset(0);
    setSelectedIds([]);
    setOpenId(null);
  }, []);

  const clearSearch = useCallback(() => {
    setSearch('');
    setActiveSearch('');
    setOffset(0);
    setSelectedIds([]);
  }, []);

  const setFilter = useCallback((next: ListFilter) => {
    setFilterState(next);
    setOffset(0);
    setSelectedIds([]);
  }, []);

  const goToPage = useCallback((nextOffset: number) => {
    setSelectedIds([]);
    setOffset(nextOffset);
  }, []);

  // --- Reading -----------------------------------------------------------------

  const messageResult = useQuery({ ...messageQuery(openId ?? '', handleUnauthorized), enabled: openId !== null });
  const threadResult = useQuery({ ...threadQuery(openId ?? '', handleUnauthorized), enabled: openId !== null });
  const openMessage = openId ? (messageResult.data ?? null) : null;
  const thread = openId ? (threadResult.data ?? NO_MESSAGES) : NO_MESSAGES;
  const loadingMessage = openingId !== null;

  /** A message body, fetched ahead of a click. Drafts are skipped: they open in compose, fresh. */
  const prefetchMessage = useCallback(
    (item: WebmailListItem) => {
      if (item.isDraft) return;
      void queryClient.prefetchQuery(messageQuery(item.id, handleUnauthorized));
    },
    [queryClient, handleUnauthorized],
  );

  // Clicking A then B quickly must end on B, whichever answer lands last.
  const openTicket = useRef(0);

  /**
   * Open a message in the reading pane. Returns the loaded message, or a
   * `draft` marker when the row is a draft -- the caller resumes writing it
   * instead, because an unsent message has nothing to read.
   */
  const open = useCallback(
    async (
      item: WebmailListItem,
    ): Promise<{ kind: 'message' } | { kind: 'draft'; message: WebmailMessage } | { kind: 'error' }> => {
      const ticket = ++openTicket.current;
      const isDraft = item.isDraft || item.folder === 'Drafts';
      setOpenError(null);
      setOpeningId(item.id);
      // The conversation is asked for alongside the body, not after it (F1).
      if (!isDraft) void queryClient.prefetchQuery(threadQuery(item.id, handleUnauthorized));
      try {
        const options = messageQuery(item.id, handleUnauthorized);
        // A draft is re-saved under a new id every autosave; never trust an old copy.
        const message = await queryClient.fetchQuery(isDraft ? { ...options, staleTime: 0 } : options);
        if (ticket !== openTicket.current) return { kind: 'error' };
        if (isDraft) return { kind: 'draft', message };

        const folder = item.folder || activeFolder;
        setOpenId(item.id);
        pushUrlState(folder, item.id);
        if (!message.isRead) {
          void apiMarkRead(item.id, handleUnauthorized);
          patchMessages(queryClient, [item.id], (m) => ({ ...m, isRead: true }));
          adjustFolderCounts(queryClient, new Map([[folder, { unread: -1, total: 0 }]]));
        }

        // The next message down is the likeliest to be read next (j, or after
        // an archive), so it is fetched while this one is being read.
        const index = messages.findIndex((m) => m.id === item.id);
        const next = index >= 0 ? messages[index + 1] : undefined;
        if (next) prefetchMessage(next);
        return { kind: 'message' };
      } catch (err) {
        if (ticket === openTicket.current) {
          setOpenError(err instanceof Error ? err.message : 'That message could not be loaded.');
        }
        return { kind: 'error' };
      } finally {
        if (ticket === openTicket.current) setOpeningId(null);
      }
    },
    [queryClient, handleUnauthorized, activeFolder, messages, prefetchMessage],
  );

  const close = useCallback(() => {
    setOpenId(null);
    pushUrlState(activeFolder, null);
  }, [activeFolder]);

  const loadThreadMessage = useCallback(
    (id: string) => queryClient.fetchQuery(messageQuery(id, handleUnauthorized)).catch(() => null),
    [queryClient, handleUnauthorized],
  );

  // Back / Forward: pushUrlState changes the address bar without telling
  // React, so history navigation has to be applied to state here.
  useEffect(() => {
    const onPopState = () => {
      const { folder, id } = readUrlState();
      const nextFolder = folder ?? 'INBOX';
      setActiveFolder((prev) => (prev === nextFolder ? prev : nextFolder));
      if (!id) {
        setOpenId(null);
        return;
      }
      setOpenId((prev) => (prev === id ? prev : null));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Deep link: a URL carrying ?id= opens that message once its list loaded.
  // Latches so closing the message does not immediately reopen it.
  const restoredDeepLink = useRef(false);
  useEffect(() => {
    if (restoredDeepLink.current || openId) return;
    const { id } = readUrlState();
    if (!id) {
      restoredDeepLink.current = true;
      return;
    }
    const item = messages.find((m) => m.id === id);
    if (!item) return;
    restoredDeepLink.current = true;
    void open(item);
  }, [messages, openId, open]);

  // --- Actions on messages -----------------------------------------------------

  /**
   * These messages are gone from where they were: out of every cached list,
   * the selection and the reading pane. Their old ids are dead -- a moved
   * message gets a new one in its new folder -- so their bodies go too.
   */
  const dropMessages = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      removeFromLists(queryClient, ids);
      setSelectedIds((prev) => prev.filter((id) => !set.has(id)));
      setOpenId((prev) => (prev && set.has(prev) ? null : prev));
      forgetMessages(queryClient, ids);
      // Every list could be holding them or be missing them now. Nothing is
      // refetched under the pointer; each list reloads when next shown.
      void invalidateFolderLists(queryClient, 'all', 'none');
    },
    [queryClient],
  );

  const toggleStar = useCallback(
    async (id: string) => {
      const currentlyStarred = findMessage(queryClient, id)?.isStarred ?? false;
      const result = await (currentlyStarred ? apiUnstar : apiStar)(id, handleUnauthorized);
      if (!result.success) {
        toast(result.message, { tone: 'error' });
        return;
      }
      patchMessages(queryClient, [id], (m) => ({ ...m, isStarred: !currentlyStarred }));
      void queryClient.invalidateQueries({
        queryKey: qk.lists,
        refetchType: 'none',
        predicate: (q) => listParamsOf(q.queryKey).starred,
      });
    },
    [queryClient, handleUnauthorized, toast],
  );

  const runOnIds = useCallback(
    async (
      ids: string[],
      action: (id: string) => Promise<{ success: boolean; message?: string }>,
      onDone: (ids: string[]) => void,
    ): Promise<number> => {
      const results = await Promise.all(ids.map(action));
      const failed = results.find((r) => !r.success);
      if (failed) toast(failed.message ?? 'Some messages could not be updated', { tone: 'error' });
      const succeeded = ids.filter((_, i) => results[i].success);
      onDone(succeeded);
      return succeeded.length;
    },
    [toast],
  );

  const afterMove = useCallback(
    (ids: string[]) => {
      dropMessages(ids);
      void refreshFolders();
    },
    [dropMessages, refreshFolders],
  );

  const archive = useCallback(
    async (ids: string[]) => {
      const n = await runOnIds(ids, (id) => apiMove(id, 'Archive', handleUnauthorized), afterMove);
      if (n > 0) toast(n === 1 ? 'Archived' : `Archived ${plural(n, 'message')}`);
    },
    [runOnIds, handleUnauthorized, afterMove, toast],
  );

  const trash = useCallback(
    async (ids: string[]) => {
      const n = await runOnIds(ids, (id) => apiTrash(id, handleUnauthorized), afterMove);
      if (n > 0) toast(n === 1 ? 'Moved to Trash' : `Moved ${plural(n, 'message')} to Trash`);
    },
    [runOnIds, handleUnauthorized, afterMove, toast],
  );

  const deleteForever = useCallback(
    async (ids: string[]) => {
      const n = await runOnIds(ids, (id) => apiDeleteForever(id, handleUnauthorized), afterMove);
      if (n > 0) toast(n === 1 ? 'Deleted forever' : `Deleted ${plural(n, 'message')} forever`);
    },
    [runOnIds, handleUnauthorized, afterMove, toast],
  );

  const move = useCallback(
    async (ids: string[], folder: string) => {
      const n = await runOnIds(ids, (id) => apiMove(id, folder, handleUnauthorized), afterMove);
      if (n > 0) toast(`Moved to ${folder === 'INBOX' ? 'Inbox' : folder}`);
    },
    [runOnIds, handleUnauthorized, afterMove, toast],
  );

  /** Mark as spam = file into Junk. Per-mailbox filing; nothing is trained. */
  const markSpam = useCallback(
    async (ids: string[]) => {
      const n = await runOnIds(ids, (id) => apiMove(id, 'Junk', handleUnauthorized), afterMove);
      if (n > 0) toast('Moved to Junk');
    },
    [runOnIds, handleUnauthorized, afterMove, toast],
  );

  /** Not spam = back to the Inbox, resolved from the folder ROLE. */
  const markNotSpam = useCallback(
    async (ids: string[]) => {
      const inbox = folderByRole('inbox', 'INBOX');
      const n = await runOnIds(ids, (id) => apiMove(id, inbox, handleUnauthorized), afterMove);
      if (n > 0) toast('Moved to Inbox');
    },
    [folderByRole, runOnIds, handleUnauthorized, afterMove, toast],
  );

  const setRead = useCallback(
    async (ids: string[], read: boolean) => {
      const action = read ? apiMarkRead : apiMarkUnread;
      await runOnIds(ids, (id) => action(id, handleUnauthorized), (done) => {
        patchMessages(queryClient, done, (m) => ({ ...m, isRead: read }));
        setSelectedIds([]);
        void refreshFolders();
        void queryClient.invalidateQueries({
          queryKey: qk.lists,
          refetchType: 'none',
          predicate: (q) => listParamsOf(q.queryKey).unread,
        });
      });
    },
    [runOnIds, handleUnauthorized, queryClient, refreshFolders],
  );

  /**
   * Mark everything unread in this folder as read.
   *
   * There is no server call for it, so this pages through the folder's
   * unread ids (SEARCH UNSEEN, 200 a page) and marks each one. Capped so a
   * mailbox with ten thousand unread newsletters does not fire ten thousand
   * requests from one click -- the toast says how many it did.
   */
  const markAllRead = useCallback(async () => {
    if (activeFolder === STARRED_VIEW || labelOfView(activeFolder) !== null || markingAllRead) return;
    setMarkingAllRead(true);
    try {
      const ids: string[] = [];
      let from = 0;
      while (ids.length < MARK_ALL_CAP) {
        const result = await listMessages(
          { folder: activeFolder, unread: true, limit: 200, offset: from },
          handleUnauthorized,
        );
        if (!result.success) {
          toast(result.message, { tone: 'error' });
          return;
        }
        ids.push(...result.data.messages.map((m) => m.id));
        if (!result.data.has_more) break;
        from += 200;
      }
      if (ids.length === 0) {
        toast('Nothing unread here', { tone: 'info' });
        return;
      }
      let done = 0;
      const marked: string[] = [];
      for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        const results = await Promise.all(chunk.map((id) => apiMarkRead(id, handleUnauthorized)));
        results.forEach((r, j) => {
          if (r.success) marked.push(chunk[j]);
        });
        done += results.filter((r) => r.success).length;
      }
      patchMessages(queryClient, marked, (m) => ({ ...m, isRead: true }));
      void refreshFolders();
      void invalidateFolderLists(queryClient, [activeFolder], 'none');
      toast(
        done >= MARK_ALL_CAP
          ? `Marked ${done} as read — run it again for the rest`
          : `Marked ${plural(done, 'message')} as read`,
      );
    } finally {
      setMarkingAllRead(false);
    }
  }, [activeFolder, markingAllRead, handleUnauthorized, queryClient, refreshFolders, toast]);

  /** Block a sender: future mail files to Junk at delivery. */
  const blockSender = useCallback(
    async (address: string) => {
      const result = await apiBlockSender(address, handleUnauthorized);
      if (!result.success) {
        toast(result.message, { tone: 'error' });
        return false;
      }
      toast(`Blocked ${address} — new mail from them goes to Junk`);
      return true;
    },
    [handleUnauthorized, toast],
  );

  /**
   * Add and remove labels on some messages, then re-read the label list in
   * case a new name was introduced.
   */
  const applyLabels = useCallback(
    async (ids: string[], add: string[], remove: string[]) => {
      if (ids.length === 0 || (add.length === 0 && remove.length === 0)) return;
      const results = await Promise.all(ids.map((id) => apiSetLabels(id, add, remove, handleUnauthorized)));
      const failed = results.find((r) => !r.success);
      if (failed) toast(failed.message ?? 'Some labels could not be changed', { tone: 'error' });
      const done = new Set(ids.filter((_, i) => results[i].success));
      if (done.size === 0) return;
      const slug = (raw: string) =>
        raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '').replace(/_{2,}/g, '_').replace(/^[_-]+|[_-]+$/g, '');
      const adds = add.map(slug).filter(Boolean);
      const removes = new Set(remove.map(slug));
      patchMessages(queryClient, done, (m) => ({
        ...m,
        labels: [...new Set([...m.labels.filter((l) => !removes.has(l)), ...adds])].sort(),
      }));
      setSelectedIds([]);
      // A message that just lost a label leaves that label's view.
      removeFromLists(queryClient, done, (params) => params.label !== null && removes.has(params.label));
      const viewLabel = labelOfView(activeFolder);
      if (viewLabel && removes.has(viewLabel)) setOpenId((prev) => (prev && done.has(prev) ? null : prev));
      // And the views of the labels it gained are missing it until they reload.
      void queryClient.invalidateQueries({
        queryKey: qk.lists,
        refetchType: 'none',
        predicate: (q) => {
          const label = listParamsOf(q.queryKey).label;
          return label !== null && adds.includes(label);
        },
      });
      toast(
        adds.length > 0
          ? `Labelled ${done.size === 1 ? 'message' : `${done.size} messages`}`
          : `Removed ${remove.length === 1 ? 'label' : 'labels'}`,
      );
      void loadLabels();
    },
    [handleUnauthorized, toast, queryClient, activeFolder, loadLabels],
  );

  // --- Folders -------------------------------------------------------------------

  const createFolder = useCallback(
    async (name: string) => {
      const result = await apiCreateFolder(name, handleUnauthorized);
      if (!result.success) return result.message;
      await refreshFolders();
      toast(`Created ${name}`);
      return null;
    },
    [handleUnauthorized, refreshFolders, toast],
  );

  const renameFolder = useCallback(
    async (folder: { id: string; name: string }, name: string) => {
      const result = await apiRenameFolder(folder.id, name, handleUnauthorized);
      if (!result.success) return result.message;
      await refreshFolders();
      if (activeFolder === folder.name && result.data?.name) setFolder(result.data.name);
      toast(`Renamed to ${result.data?.name ?? name}`);
      return null;
    },
    [handleUnauthorized, refreshFolders, activeFolder, setFolder, toast],
  );

  const deleteFolder = useCallback(
    async (folder: { id: string; name: string }) => {
      const result = await apiDeleteFolder(folder.id, handleUnauthorized);
      if (!result.success) return result.message;
      await refreshFolders();
      if (activeFolder === folder.name) setFolder('INBOX');
      toast(`Deleted ${folder.name}`);
      return null;
    },
    [handleUnauthorized, refreshFolders, activeFolder, setFolder, toast],
  );

  // --- Drafts --------------------------------------------------------------------

  // Stable across folder switches and paging, so compose's autosave timer is
  // not restarted by every navigation.
  const saveDraft = useCallback(
    async (payload: ComposePayload, replaceId?: string) => {
      const result = await apiSaveDraft(
        {
          to: splitAddresses(payload.to),
          cc: payload.cc ? splitAddresses(payload.cc) : undefined,
          bcc: payload.bcc ? splitAddresses(payload.bcc) : undefined,
          subject: payload.subject,
          body_html: payload.body,
          in_reply_to: payload.inReplyTo,
          references: payload.references,
          replace_id: replaceId,
        },
        handleUnauthorized,
      );
      if (!result.success || !result.data) return null;
      void refreshFolders();
      void invalidateFolderLists(queryClient, [draftsFolder]);
      return result.data.id;
    },
    [handleUnauthorized, refreshFolders, queryClient, draftsFolder],
  );

  const discardDraft = useCallback(
    async (id: string) => {
      await apiDiscardDraft(id, handleUnauthorized);
      removeFromLists(queryClient, [id]);
      forgetMessages(queryClient, [id]);
      void refreshFolders();
      void invalidateFolderLists(queryClient, [draftsFolder]);
    },
    [handleUnauthorized, queryClient, refreshFolders, draftsFolder],
  );

  // --- Sending -------------------------------------------------------------------

  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deliver = useCallback(
    async (payload: ComposePayload) => {
      const result = await apiSend(
        {
          to: splitAddresses(payload.to),
          cc: payload.cc ? splitAddresses(payload.cc) : undefined,
          bcc: payload.bcc ? splitAddresses(payload.bcc) : undefined,
          subject: payload.subject,
          body_html: payload.body,
          in_reply_to: payload.inReplyTo,
          references: payload.references,
          send_at: payload.sendAt,
          from: payload.from,
        },
        payload.attachments ?? [],
        handleUnauthorized,
      );

      if (!result.success) {
        const verb = payload.sendAt ? 'was not scheduled' : 'was not sent';
        toast(`"${payload.subject || '(no subject)'}" ${verb}: ${result.message}`, {
          tone: 'error',
        });
        return;
      }

      void refreshFolders();

      if (payload.sendAt) {
        toast(`Scheduled to send ${formatSendAt(new Date(payload.sendAt))}`);
        void queryClient.invalidateQueries({ queryKey: qk.lists });
        void loadScheduled();
        return;
      }

      if (result.data && result.data.filed_to_sent === false) {
        toast('Sent — filing to your Sent folder is still in progress', { tone: 'warning' });
      } else {
        const recipients = splitAddresses(payload.to);
        const who =
          recipients.length === 1
            ? recipients[0]
            : `${recipients[0]} and ${recipients.length - 1} other${recipients.length === 2 ? '' : 's'}`;
        toast(`Message sent to ${who}`);
      }
      // Sent gains a copy, and a reply changes the conversation it answered.
      void invalidateFolderLists(queryClient, [sentFolder]);
      void queryClient.invalidateQueries({ queryKey: qk.threads });
    },
    [handleUnauthorized, toast, refreshFolders, queryClient, loadScheduled, sentFolder],
  );

  /**
   * Undo send: a client-side hold, not a server-side recall. The message has
   * simply not been handed to Postfix yet. Once the window closes it is gone
   * and nothing on screen offers an Undo that would no longer work.
   */
  const send = useCallback(
    async (payload: ComposePayload, context: SendContext) => {
      // A scheduled message skips the hold; it can be called back from the
      // Scheduled folder for the whole of the wait.
      if (payload.sendAt || !settings?.undoSendEnabled) {
        void deliver(payload);
        return { success: true as const };
      }

      const windowMs = (settings.undoSendSeconds || DEFAULT_UNDO_SECONDS) * 1000;
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => {
        undoTimerRef.current = null;
        setPendingSend(null);
        void deliver(payload);
      }, windowMs);

      setPendingSend({
        subject: payload.subject || '(no subject)',
        until: Date.now() + windowMs,
        payload,
        context,
      });
      return { success: true as const };
    },
    [deliver, settings],
  );

  /** Stop the pending send. Returns what was held so the caller can reopen it. */
  const cancelUndo = useCallback((): PendingSend | null => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    const held = pendingSend;
    setPendingSend(null);
    return held;
  }, [pendingSend]);

  /** Send times keyed by message id, for the list to render. */
  const sendTimes = useMemo(() => {
    const map: Record<string, { label: string; failed: boolean; error: string | null }> = {};
    for (const row of scheduled) {
      map[row.id] = {
        label: row.send_at ? formatSendAt(new Date(row.send_at)) : 'Scheduled',
        failed: row.status === 'failed',
        error: row.error,
      };
    }
    return map;
  }, [scheduled]);

  const cancelScheduledSend = useCallback(
    async (id: string) => {
      const result = await apiCancelScheduled(id, handleUnauthorized);
      if (!result.success) {
        toast(`Could not cancel that scheduled message: ${result.message}`, { tone: 'error' });
        return;
      }
      // Back in Drafts, under a new id.
      removeFromLists(queryClient, [id]);
      setOpenId((prev) => (prev === id ? null : prev));
      forgetMessages(queryClient, [id]);
      toast('Send cancelled — the message is in your drafts');
      void loadScheduled();
      void refreshFolders();
      void queryClient.invalidateQueries({ queryKey: qk.lists });
    },
    [handleUnauthorized, toast, queryClient, loadScheduled, refreshFolders],
  );

  // --- AI --------------------------------------------------------------------------

  const aiWrite = useCallback(
    async (instruction: string, existingBody: string) => {
      const result = await apiAiCompose(instruction, existingBody, handleUnauthorized);
      if (!result.success) throw new Error(result.message);
      return result.data.draft;
    },
    [handleUnauthorized],
  );

  /** A conversation's summary: made once and kept, unless asked for afresh. */
  const summarize = useCallback(
    (id: string, fresh = false) => {
      const options = summaryQuery(id, handleUnauthorized);
      return queryClient.fetchQuery(fresh ? { ...options, staleTime: 0 } : options);
    },
    [queryClient, handleUnauthorized],
  );

  // --- Derived ---------------------------------------------------------------------

  /** The page, minus what the page-local attachments pill hides. */
  const visibleMessages = useMemo(
    () => (filter === 'attachments' ? messages.filter((m) => m.hasAttachment) : messages),
    [messages, filter],
  );

  /** Unread across the whole mailbox, from the folder counts. */
  const unreadCount = useMemo(
    () => folders.reduce((sum, f) => sum + (f.role === 'trash' ? 0 : f.unreadEmails), 0),
    [folders],
  );

  /**
   * The signature a new message starts with (PRD C3). Two empty paragraphs
   * above it leave room to write; in a reply the block sits above the
   * quotation. Resumed drafts and an undone send are not seeded again.
   */
  const signatureSeed = useCallback(
    (mode: ComposeMode): string => {
      const html = settings?.signatureHtml.trim() ?? '';
      if (!html) return '';
      if ((mode === 'reply' || mode === 'replyAll') && !settings?.signatureOnReply) return '';
      return `<p></p><p></p>${html}`;
    },
    [settings],
  );

  return {
    // session
    sessionChecked,
    displayEmail,
    settings,
    capabilities,
    aiAvailable,
    scheduleAvailable,
    calendarAvailable,
    contactsAvailable,
    sharedMailboxes,
    contacts,
    handleUnauthorized,
    // folders
    folders,
    activeFolder,
    activeFolderMeta,
    inTrash,
    inJunk,
    setFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    unreadCount,
    // list
    messages: visibleMessages,
    total,
    offset: shownOffset,
    loadingList,
    refreshing,
    isPlaceholderPage,
    error,
    lastSyncAt,
    refreshAll,
    goToPage,
    prefetchNextPage,
    selectedIds,
    setSelectedIds,
    search,
    setSearch,
    activeSearch,
    searchScope,
    runSearch,
    clearSearch,
    filter,
    setFilter,
    sendTimes,
    // reading
    openMessage,
    thread,
    loadingMessage,
    open,
    close,
    loadThreadMessage,
    prefetchMessage,
    // actions
    toggleStar,
    archive,
    trash,
    deleteForever,
    move,
    markSpam,
    markNotSpam,
    setRead,
    markAllRead,
    markingAllRead,
    blockSender,
    labels,
    applyLabels,
    cancelScheduledSend,
    // compose plumbing
    saveDraft,
    discardDraft,
    send,
    pendingSend,
    cancelUndo,
    aiWrite,
    summarize,
    signatureSeed,
  };
}

export type Mailbox = ReturnType<typeof useMailbox>;
