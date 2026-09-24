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
 *
 * Actions on messages are optimistic. They change the screen in the same
 * frame as the click and are sent behind it (query/pendingOps.ts); moves and
 * deletions to Trash wait out a few seconds of Undo first. A refusal puts
 * things back and says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notifyManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/Toast';
import type { ComposeMode, WebmailFolder, WebmailListItem, WebmailMessage } from '@/components/webmail/types';
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
import type { BulkRequest, SharedMailbox } from '@/lib/webmail/client';
import { formatSendAt } from '@/lib/webmail/scheduleTimes';
import { splitAddresses } from '@/lib/webmail/addresses';
import { useOutbox, type PendingSend, type SendContext } from '@/components/providers/OutboxProvider';
import {
  deltasOf,
  failureText,
  isSessionStatus,
  loadScheduled as loadScheduledIn,
  refreshFolders as refreshFoldersIn,
  settleRemoval as settleRemovalIn,
} from '@/lib/webmail/query/removals';
import { FALLBACK_FOLDERS, toFolder } from '@/lib/webmail/adapters';
import {
  useCapabilities,
  useLabels,
  useScheduled,
  useSettings,
  useSuggestions,
} from '@/lib/webmail/query/accountQueries';
import { isAuthError } from '@/lib/webmail/query/errors';
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
import {
  addDelta,
  adjustFolderCounts,
  findMessage,
  invalidateFolderLists,
  listParamsOf,
  patchMessages,
  removeFromLists,
  type FolderDeltas,
} from '@/lib/webmail/query/messageCache';
import {
  commitOp,
  discardHeld,
  queueGeneration,
  registerHeld,
  releaseHeld,
  type OpOutcome,
  type OpRequest,
  type OpSender,
} from '@/lib/webmail/query/opRunner';
import { BULK_CHUNK, bulkAvailable, bulkSender } from '@/lib/webmail/query/bulk';
import {
  applyFlagPatch,
  opsStoreOf,
  overlayFolders,
  overlayMessage,
  overlayPage,
  usePendingOps,
  type FlagPatch,
  type FlagsOp,
  type RemoveOp,
  type RemoveReason,
} from '@/lib/webmail/query/pendingOps';
import { useUnauthorizedHandler } from '@/lib/webmail/query/session';
import { settingsKeys } from '@/lib/webmail/query/settingsQueries';

export { PAGE_SIZE, STARRED_VIEW, LABEL_VIEW_PREFIX, labelOfView } from '@/lib/webmail/query/listParams';
export type { ListFilter, SearchScope } from '@/lib/webmail/query/listParams';

/** The most rows "mark all read" will touch in one go. */
const MARK_ALL_CAP = 1000;


/** How long a move or a delete to Trash can be taken back before it is sent. */
const UNDO_MS = 6000;

export { splitAddresses };
export type { PendingSend, SendContext };

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


const NO_SHARED_MAILBOXES: SharedMailbox[] = [];
const NO_MESSAGES: WebmailListItem[] = [];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function useMailbox() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const handleUnauthorized = useUnauthorizedHandler();
  const store = opsStoreOf(queryClient);
  const pendingOps = usePendingOps();

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
  const [markingAllRead, setMarkingAllRead] = useState(false);

  // The open message, readable from callbacks that outlive the render they
  // were made in (an Undo pressed six seconds later).
  const openIdRef = useRef<string | null>(null);
  useEffect(() => {
    openIdRef.current = openId;
  }, [openId]);

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
  // The counts include every action not yet confirmed, so the badges and the
  // tab title move with the click.
  const folders = useMemo(
    () => overlayFolders(foldersResult.data ?? FALLBACK_FOLDERS, pendingOps),
    [foldersResult.data, pendingOps],
  );

  const activeFolderMeta = folders.find((f) => f.name === activeFolder) ?? null;
  const inTrash = activeFolderMeta?.role === 'trash';
  const inJunk = activeFolderMeta?.role === 'junk';
  const folderByRole = useCallback(
    (role: string, fallback: string) => folders.find((f) => f.role === role)?.name ?? fallback,
    [folders],
  );
  const inboxFolder = folderByRole('inbox', 'INBOX');
  const archiveFolder = folderByRole('archive', 'Archive');
  const junkFolder = folderByRole('junk', 'Junk');
  const trashFolder = folderByRole('trash', 'Trash');
  const draftsFolder = folderByRole('drafts', 'Drafts');
  const sentFolder = folderByRole('sent', 'Sent');

  /**
   * Fetch the folder list after the client changed something itself. Its
   * answer carries that change, which is already on screen, so it becomes the
   * new baseline instead of reloading lists.
   */
  const refreshFolders = useCallback(() => refreshFoldersIn(queryClient), [queryClient]);

  // --- The message list ------------------------------------------------------------------

  const listParams = useMemo(
    () => listParamsFor({ folder: activeFolder, search: activeSearch, scope: searchScope, filter, offset }),
    [activeFolder, activeSearch, searchScope, filter, offset],
  );
  const listResult = useQuery(listQuery(listParams, handleUnauthorized));
  const page = useMemo(
    () => overlayPage(listResult.data, listParams, pendingOps),
    [listResult.data, listParams, pendingOps],
  );
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

  /** The page, minus what the page-local attachments pill hides. */
  const visibleMessages = useMemo(
    () => (filter === 'attachments' ? messages.filter((m) => m.hasAttachment) : messages),
    [messages, filter],
  );

  // Until the first authenticated request comes back, we do not know whether
  // there is a session at all. Rendering the mailbox before then meant a
  // signed-out visitor saw the full interface, then a redirect. A 401 never
  // opens this gate, so the mailbox never paints on the way out to sign-in.
  const sessionConfirmed =
    listResult.data !== undefined ||
    foldersResult.data !== undefined ||
    capabilitiesQuery.data !== undefined ||
    // Any other failure is worth showing as one, with Try again.
    (listResult.isError && !isAuthError(listResult.error));
  // Once open, the gate stays open. A background refetch that fails flips a
  // query's status to error while keeping its data; closing the gate then
  // would swap the whole mailbox -- open compose windows included -- for the
  // skeleton. A real sign-out leaves the page, so nothing needs to close it.
  const [sessionLatched, setSessionLatched] = useState(false);
  if (sessionConfirmed && !sessionLatched) setSessionLatched(true);
  const sessionChecked = sessionLatched || sessionConfirmed;

  const syncedAt = Math.max(foldersResult.dataUpdatedAt, listResult.dataUpdatedAt);
  const lastSyncAt = useMemo(() => (syncedAt > 0 ? new Date(syncedAt) : null), [syncedAt]);

  // Scheduled and labels are account-wide queries; after a change, ask them to look again.
  const loadScheduled = useCallback(() => loadScheduledIn(queryClient), [queryClient]);
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
    setOpenError(null);
  }, []);

  const clearSearch = useCallback(() => {
    setSearch('');
    setActiveSearch('');
    setOffset(0);
    setSelectedIds([]);
    setOpenError(null);
  }, []);

  const setFilter = useCallback((next: ListFilter) => {
    setFilterState(next);
    setOffset(0);
    setSelectedIds([]);
    setOpenError(null);
  }, []);

  const goToPage = useCallback((nextOffset: number) => {
    setSelectedIds([]);
    setOffset(nextOffset);
    setOpenError(null);
  }, []);

  // --- Optimistic actions: the plumbing ------------------------------------------------

  // The rows on screen, readable from callbacks without re-creating them.
  const shownRef = useRef<{ rows: WebmailListItem[]; open: WebmailListItem | null }>({ rows: [], open: null });

  /**
   * A message as the person sees it now: the row on screen if there is one,
   * else the open message, else the freshest cached copy -- with pending
   * actions laid over. The row on screen matters: another cached list may
   * hold an older copy, and acting on its flags would do the opposite of
   * what was clicked.
   */
  const currentRow = useCallback(
    (id: string) => {
      const { rows, open } = shownRef.current;
      const row =
        rows.find((m) => m.id === id) ?? (open && open.id === id ? open : undefined) ?? findMessage(queryClient, id);
      return row ? overlayMessage(row, store.getSnapshot()) : undefined;
    },
    [queryClient, store],
  );

  const settleRemoval = useCallback(
    (op: RemoveOp, outcome: OpOutcome) => settleRemovalIn(queryClient, toast, op, outcome),
    [queryClient, toast],
  );

  /** A flag change was answered: the same, for read, starred and labels. */
  const settleFlags = useCallback(
    (op: FlagsOp, outcome: OpOutcome, quiet: boolean) => {
      notifyManager.batch(() => {
        if (outcome.ok.length > 0) {
          patchMessages(queryClient, outcome.ok, (m) => applyFlagPatch(m, op.patch));
          adjustFolderCounts(queryClient, deltasOf(op, outcome.ok));
          // Out of the cached views it no longer belongs in, so the cache
          // itself agrees with the server once the pending action is gone.
          // Unless a later action, still pending, puts it straight back.
          const later = store.getSnapshot().ops.filter((o) => o.opId > op.opId && o.kind === 'flags');
          if (op.patch.isStarred === false) {
            const out = outcome.ok.filter(
              (id) => !later.some((o) => o.kind === 'flags' && o.idSet.has(id) && o.patch.isStarred === true),
            );
            removeFromLists(queryClient, out, (p) => p.starred);
          }
          for (const label of op.patch.removeLabels ?? []) {
            const out = outcome.ok.filter(
              (id) => !later.some((o) => o.kind === 'flags' && o.idSet.has(id) && o.patch.addLabels?.includes(label)),
            );
            removeFromLists(queryClient, out, (p) => p.label === label);
          }
        }
        notifyManager.schedule(() => {
          if (outcome.ok.length === 0) {
            store.drop(op.opId);
            return;
          }
          // Kept a little longer, confirmed, so a list that left before this
          // answer cannot paint the old flag back.
          store.narrow(op.opId, outcome.ok);
          store.setState(op.opId, 'settled');
        });
      });

      // The folders are asked again, and the unread count this changed is
      // taken as the new baseline -- so a message just read stays in the
      // Unread filter until the next visit. New mail is never absorbed.
      if (op.patch.isRead !== undefined) void refreshFolders();
      // Lists whose membership this changes -- Starred, Unread, the label
      // views -- reload when next shown; one it adds a message to, at once if
      // it is on screen (the row cannot be added by hand, it is not in the page).
      const touchedLabels = new Set([...(op.patch.addLabels ?? []), ...(op.patch.removeLabels ?? [])]);
      const adds = op.patch.isStarred === true || (op.patch.addLabels?.length ?? 0) > 0;
      void queryClient.invalidateQueries({
        queryKey: qk.lists,
        refetchType: adds ? 'active' : 'none',
        predicate: (q) => {
          const params = listParamsOf(q.queryKey);
          return (
            (op.patch.isStarred !== undefined && params.starred) ||
            (op.patch.isRead !== undefined && params.unread) ||
            (params.label !== null && touchedLabels.has(params.label))
          );
        },
      });
      if (touchedLabels.size > 0) void loadLabels();

      if (outcome.failed.length > 0 && !quiet && !isSessionStatus(outcome.firstStatus)) {
        toast(failureText('update', outcome.failed.length, op.ids.length, outcome.firstError), { tone: 'error' });
      }
    },
    [queryClient, store, refreshFolders, loadLabels, toast],
  );

  /**
   * How an action goes to the server: one request per message, and -- when
   * the server has bulk actions -- the same action for many messages in one
   * request. The queue uses the bulk form for a batch and falls back to one
   * by one if the server turns out not to have it.
   */
  const sendAs = useCallback(
    (one: OpRequest, bulk: Omit<BulkRequest, 'ids'>): OpSender =>
      bulkAvailable(queryClient) ? { one, many: bulkSender(bulk, handleUnauthorized) } : one,
    [queryClient, handleUnauthorized],
  );

  /** Change flags now, send behind. */
  const runFlags = useCallback(
    (ids: string[], patch: FlagPatch, request: OpSender, options: { quiet?: boolean } = {}) => {
      if (ids.length === 0) return;
      const deltasById = new Map<string, FolderDeltas>();
      if (patch.isRead !== undefined) {
        for (const id of ids) {
          const row = currentRow(id);
          if (!row || row.isRead === patch.isRead) continue;
          const deltas: FolderDeltas = new Map();
          addDelta(deltas, row.folder, patch.isRead ? -1 : 1, 0);
          deltasById.set(id, deltas);
        }
      }
      const op = store.add({ kind: 'flags', ids, patch, deltasById }, 'running');
      commitOp(queryClient, op.opId, request, (settled, outcome) =>
        settleFlags(settled as FlagsOp, outcome, options.quiet ?? false),
      );
    },
    [currentRow, store, queryClient, settleFlags],
  );

  // --- Reading -----------------------------------------------------------------

  const messageResult = useQuery({ ...messageQuery(openId ?? '', handleUnauthorized), enabled: openId !== null });
  const threadResult = useQuery({ ...threadQuery(openId ?? '', handleUnauthorized), enabled: openId !== null });
  const openMessage = useMemo(
    () => (openId && messageResult.data ? overlayMessage(messageResult.data, pendingOps) : null),
    [openId, messageResult.data, pendingOps],
  );
  const thread = useMemo(
    () => (openId && threadResult.data ? threadResult.data.map((m) => overlayMessage(m, pendingOps)) : NO_MESSAGES),
    [openId, threadResult.data, pendingOps],
  );
  const loadingMessage = openingId !== null;

  useEffect(() => {
    shownRef.current = { rows: visibleMessages, open: openMessage };
  }, [visibleMessages, openMessage]);

  // The open message stopped existing under its id -- its folder's ids were
  // reissued, or the server says it is gone. Close the pane rather than leave
  // it blank, or show whatever now has that id.
  useEffect(() => {
    if (!openId) return;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed' && event.query.queryKey[2] === openId && event.query.queryKey[1] === 'message') {
        setOpenId(null);
        pushUrlState(activeFolderRef.current, null, true);
      }
    });
  }, [queryClient, openId]);
  useEffect(() => {
    if (!openId || !messageResult.isError || messageResult.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenError(messageResult.error.message);
    setOpenId(null);
    pushUrlState(activeFolderRef.current, null, true);
  }, [openId, messageResult.isError, messageResult.data, messageResult.error]);

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

        setOpenId(item.id);
        pushUrlState(item.folder || activeFolder, item.id);
        // Either being unread is enough: the row is what the poll keeps
        // current, the body may be a copy cached minutes ago. Marking read
        // twice is harmless on the server.
        if (!currentRow(item.id)?.isRead || !message.isRead) {
          runFlags([item.id], { isRead: true }, (id) => apiMarkRead(id, handleUnauthorized), { quiet: true });
        }

        // The next message down is the likeliest to be read next (j, or after
        // an archive), so it is fetched while this one is being read.
        const index = visibleMessages.findIndex((m) => m.id === item.id);
        const next = index >= 0 ? visibleMessages[index + 1] : undefined;
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
    [queryClient, handleUnauthorized, activeFolder, currentRow, runFlags, visibleMessages, prefetchMessage],
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
  const activeFolderRef = useRef(activeFolder);
  useEffect(() => {
    activeFolderRef.current = activeFolder;
  }, [activeFolder]);

  useEffect(() => {
    const onPopState = () => {
      const { folder, id } = readUrlState();
      const nextFolder = folder ?? 'INBOX';
      // Another folder starts on its first page, as a click on it would.
      // Back from an open message stays on the page it was opened from.
      if (nextFolder !== activeFolderRef.current) {
        activeFolderRef.current = nextFolder;
        setActiveFolder(nextFolder);
        setOffset(0);
        setSelectedIds([]);
        setOpenError(null);
      }
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

  /**
   * The open message is being taken away. On a desktop the next message in
   * the list opens in its place -- already fetched, so at once; on a phone
   * the list comes back. Reports where it went, so Undo can come back.
   */
  const stepAwayFrom = useCallback(
    (removed: ReadonlySet<string>): { from: string; to: string | null } | null => {
      const current = openIdRef.current;
      if (!current || !removed.has(current)) return null;
      const desktop = window.matchMedia('(min-width: 768px)').matches;
      const index = visibleMessages.findIndex((m) => m.id === current);
      const candidates =
        index < 0 ? [] : [...visibleMessages.slice(index + 1), ...visibleMessages.slice(0, index).reverse()];
      // A draft would open in compose, which is not "the next message".
      const next = desktop ? candidates.find((m) => !removed.has(m.id) && !m.isDraft) : undefined;
      if (next) {
        void open(next);
      } else {
        setOpenId(null);
        pushUrlState(activeFolder, null, true);
      }
      return { from: current, to: next?.id ?? null };
    },
    [visibleMessages, open, activeFolder],
  );

  /**
   * Take messages out of view now and send the change behind. With `undo`,
   * nothing is sent until the Undo toast has gone: taking it back then costs
   * no request at all, which matters because a moved message gets an id the
   * client never learns -- there would be nothing to move back.
   */
  const runRemoval = useCallback(
    (
      requested: string[],
      reason: RemoveReason,
      dest: string | null,
      request: OpSender,
      confirmation: string | null,
      undo: boolean,
    ) => {
      // A message already on its way somewhere: if that move is still held,
      // this one replaces it (one move, from where the message really is); if
      // it is being sent, or has gone, its id is dead and this would miss.
      const accepted: string[] = [];
      let stillMoving = 0;
      for (const id of requested) {
        const motion = store.isInMotion(id);
        if (!motion) {
          accepted.push(id);
        } else if (motion.held) {
          const remaining = motion.held.ids.filter((other) => other !== id);
          if (remaining.length > 0) store.narrow(motion.held.opId, remaining);
          else discardHeld(queryClient, motion.held.opId);
          accepted.push(id);
        } else {
          stillMoving += 1;
        }
      }
      if (stillMoving > 0) toast('Still being moved — try again in a moment', { tone: 'info' });
      if (accepted.length === 0) return;
      const ids = accepted;

      const removed = new Set(ids);
      const deltasById = new Map<string, FolderDeltas>();
      for (const id of ids) {
        const row = currentRow(id);
        if (!row) continue;
        // Where the message really is: the cached copy, not a row a pending move relabelled.
        const folder = findMessage(queryClient, id)?.folder ?? row.folder;
        // Moving a message to the folder it is already in changes no count.
        if (folder === dest) continue;
        const deltas: FolderDeltas = new Map();
        const unread = row.isRead ? 0 : 1;
        addDelta(deltas, folder, -unread, -1);
        if (dest) addDelta(deltas, dest, unread, 1);
        deltasById.set(id, deltas);
      }

      const op = store.add({ kind: 'remove', reason, dest, ids, deltasById }, undo ? 'held' : 'running');
      setSelectedIds((prev) => prev.filter((id) => !removed.has(id)));
      const away = stepAwayFrom(removed);
      const folderAtAction = activeFolder;
      const commit = () =>
        commitOp(queryClient, op.opId, request, (settled, outcome) => settleRemoval(settled as RemoveOp, outcome));

      if (!undo) {
        commit();
        if (confirmation) toast(confirmation);
        return;
      }

      registerHeld(queryClient, op.opId, commit);
      toast(confirmation ?? 'Done', {
        duration: UNDO_MS,
        action: { label: 'Undo', onClick: () => {} },
        onClose: (why) => {
          if (why !== 'action') {
            releaseHeld(queryClient, op.opId);
            return;
          }
          // Too late if it has already been sent (released early, by a
          // switch or by adding an account): taking the rows back then would
          // show them where the server no longer has them.
          if (store.get(op.opId)?.state !== 'held') {
            toast('Too late to undo — it has already been done', { tone: 'info' });
            return;
          }
          discardHeld(queryClient, op.opId);
          // Back to the message that was open, unless another has been opened since.
          if (away && openIdRef.current === away.to) {
            setOpenId(away.from);
            pushUrlState(folderAtAction, away.from, true);
          }
        },
      });
    },
    [currentRow, store, stepAwayFrom, activeFolder, queryClient, settleRemoval, toast],
  );

  // --- Actions on messages -----------------------------------------------------

  const toggleStar = useCallback(
    async (id: string) => {
      const starred = currentRow(id)?.isStarred ?? false;
      runFlags([id], { isStarred: !starred }, (target) => (starred ? apiUnstar : apiStar)(target, handleUnauthorized));
    },
    [currentRow, runFlags, handleUnauthorized],
  );

  const archive = useCallback(
    async (ids: string[]) => {
      runRemoval(
        ids,
        'archive',
        archiveFolder,
        sendAs((id) => apiMove(id, archiveFolder, handleUnauthorized), { action: 'move', folder: archiveFolder }),
        ids.length === 1 ? 'Archived' : `Archived ${plural(ids.length, 'message')}`,
        true,
      );
    },
    [runRemoval, archiveFolder, handleUnauthorized],
  );

  const trash = useCallback(
    async (ids: string[]) => {
      runRemoval(
        ids,
        'trash',
        trashFolder,
        sendAs((id) => apiTrash(id, handleUnauthorized), { action: 'trash' }),
        ids.length === 1 ? 'Moved to Trash' : `Moved ${plural(ids.length, 'message')} to Trash`,
        true,
      );
    },
    [runRemoval, trashFolder, handleUnauthorized],
  );

  /** Never held: it follows a typed confirmation, and there is nothing to undo it into. */
  const deleteForever = useCallback(
    async (ids: string[]) => {
      runRemoval(
        ids,
        'deleteForever',
        null,
        sendAs((id) => apiDeleteForever(id, handleUnauthorized), { action: 'delete' }),
        ids.length === 1 ? 'Deleted forever' : `Deleted ${plural(ids.length, 'message')} forever`,
        false,
      );
    },
    [runRemoval, handleUnauthorized],
  );

  const move = useCallback(
    async (ids: string[], folder: string) => {
      runRemoval(
        ids,
        'move',
        folder,
        sendAs((id) => apiMove(id, folder, handleUnauthorized), { action: 'move', folder }),
        `Moved to ${folder === 'INBOX' ? 'Inbox' : folder}`,
        true,
      );
    },
    [runRemoval, handleUnauthorized],
  );

  /** Mark as spam = file into Junk. Per-mailbox filing; nothing is trained. */
  const markSpam = useCallback(
    async (ids: string[]) => {
      runRemoval(
        ids,
        'spam',
        junkFolder,
        sendAs((id) => apiMove(id, junkFolder, handleUnauthorized), { action: 'move', folder: junkFolder }),
        'Moved to Junk',
        true,
      );
    },
    [runRemoval, junkFolder, handleUnauthorized],
  );

  /** Not spam = back to the Inbox, resolved from the folder ROLE. */
  const markNotSpam = useCallback(
    async (ids: string[]) => {
      runRemoval(
        ids,
        'notSpam',
        inboxFolder,
        sendAs((id) => apiMove(id, inboxFolder, handleUnauthorized), { action: 'move', folder: inboxFolder }),
        'Moved to Inbox',
        true,
      );
    },
    [runRemoval, inboxFolder, handleUnauthorized],
  );

  const setRead = useCallback(
    async (ids: string[], read: boolean) => {
      runFlags(
        ids,
        { isRead: read },
        sendAs((id) => (read ? apiMarkRead : apiMarkUnread)(id, handleUnauthorized), {
          action: read ? 'mark_read' : 'mark_unread',
        }),
      );
      setSelectedIds([]);
    },
    [runFlags, handleUnauthorized],
  );

  /**
   * Mark everything unread in this folder as read.
   *
   * There is no server call for it, so this pages through the folder's
   * unread ids (SEARCH UNSEEN, 200 a page) and marks each one. Capped so a
   * mailbox with ten thousand unread newsletters does not fire ten thousand
   * requests from one click -- the toast says how many it did. On screen,
   * the folder reads as read from the click; the work runs behind.
   */
  const markAllRead = useCallback(async () => {
    if (activeFolder === STARRED_VIEW || labelOfView(activeFolder) !== null || markingAllRead) return;
    const folder = activeFolder;
    const unread = folders.find((f) => f.name === folder)?.unreadEmails ?? 0;
    const op = store.add(
      { kind: 'folderRead', folder, ids: [], deltasById: new Map([['*', new Map([[folder, { unread: -unread, total: 0 }]])]]) },
      'running',
    );
    setMarkingAllRead(true);
    const marked: string[] = [];
    // Stops, part-way if need be, if the session changes hands: the next page
    // of ids would be marked in someone else's mailbox.
    const generation = queueGeneration(queryClient);
    const stillOurs = () => queueGeneration(queryClient) === generation;
    try {
      const ids: string[] = [];
      let from = 0;
      while (ids.length < MARK_ALL_CAP) {
        if (!stillOurs()) return;
        const result = await listMessages({ folder, unread: true, limit: 200, offset: from }, handleUnauthorized);
        if (!result.success) {
          if (!isSessionStatus(result.status ?? null)) toast(result.message, { tone: 'error' });
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
      // 200 at a time in one request each where the server takes bulk
      // actions; otherwise, or once it turns out not to, 25 at a time one by one.
      let many = bulkAvailable(queryClient) ? bulkSender({ action: 'mark_read' }, handleUnauthorized) : null;
      for (let i = 0; i < ids.length; ) {
        if (!stillOurs()) return;
        if (many) {
          const chunk = ids.slice(i, i + BULK_CHUNK);
          const answer = await many(chunk);
          if (answer.kind === 'unsupported') {
            many = null;
            continue;
          }
          if (answer.kind === 'results') {
            for (const id of chunk) if (answer.perId.get(id)?.success) marked.push(id);
          }
          i += chunk.length;
        } else {
          const chunk = ids.slice(i, i + 25);
          const results = await Promise.all(chunk.map((id) => apiMarkRead(id, handleUnauthorized)));
          results.forEach((r, j) => {
            if (r.success) marked.push(chunk[j]);
          });
          i += chunk.length;
        }
      }
      toast(
        marked.length >= MARK_ALL_CAP
          ? `Marked ${marked.length} as read — run it again for the rest`
          : `Marked ${plural(marked.length, 'message')} as read`,
      );
    } finally {
      // What was actually marked goes into the cache; anything else reverts
      // to how the server has it when the pending action is dropped.
      notifyManager.batch(() => {
        patchMessages(queryClient, marked, (m) => (m.isRead ? m : { ...m, isRead: true }));
        adjustFolderCounts(queryClient, new Map([[folder, { unread: -marked.length, total: 0 }]]));
        notifyManager.schedule(() => {
          // An earlier "mark unread" still laid over these rows must not
          // paint them unread again: this is the newer word on them.
          const markedSet = new Set(marked);
          for (const other of store.getSnapshot().ops) {
            if (other.kind !== 'flags' || other.state !== 'settled' || other.patch.isRead !== false) continue;
            const keep = other.ids.filter((id) => !markedSet.has(id));
            if (keep.length === other.ids.length) continue;
            if (keep.length === 0) store.drop(other.opId);
            else store.narrow(other.opId, keep);
          }
          store.drop(op.opId);
        });
      });
      void refreshFolders();
      void invalidateFolderLists(queryClient, [folder], 'none');
      setMarkingAllRead(false);
    }
  }, [activeFolder, markingAllRead, folders, store, handleUnauthorized, queryClient, refreshFolders, toast]);

  /** Block a sender: future mail files to Junk at delivery. */
  const blockSender = useCallback(
    async (address: string) => {
      const result = await apiBlockSender(address, handleUnauthorized);
      if (!result.success) {
        toast(result.message, { tone: 'error' });
        return false;
      }
      // Settings › Blocked senders shows the same list, already updated.
      if (result.data) queryClient.setQueryData(settingsKeys.blocked, result.data);
      toast(`Blocked ${address} — new mail from them goes to Junk`);
      return true;
    },
    [handleUnauthorized, queryClient, toast],
  );

  /** Add and remove labels on some messages. */
  const applyLabels = useCallback(
    async (ids: string[], add: string[], remove: string[]) => {
      if (ids.length === 0 || (add.length === 0 && remove.length === 0)) return;
      // The server stores labels as slugs ("Action needed" -> "action_needed").
      const slug = (raw: string) =>
        raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '').replace(/_{2,}/g, '_').replace(/^[_-]+|[_-]+$/g, '');
      const adds = add.map(slug).filter(Boolean);
      const removes = remove.map(slug).filter(Boolean);
      runFlags(
        ids,
        { addLabels: adds, removeLabels: removes },
        sendAs((id) => apiSetLabels(id, add, remove, handleUnauthorized), { action: 'labels', add, remove }),
      );
      setSelectedIds([]);
      // A message that loses the label this view shows leaves the view.
      const viewLabel = labelOfView(activeFolder);
      if (viewLabel && removes.includes(viewLabel)) stepAwayFrom(new Set(ids));
      toast(
        adds.length > 0
          ? `Labelled ${ids.length === 1 ? 'message' : `${ids.length} messages`}`
          : `Removed ${remove.length === 1 ? 'label' : 'labels'}`,
      );
    },
    [runFlags, handleUnauthorized, activeFolder, stepAwayFrom, toast],
  );

  // --- Folders -------------------------------------------------------------------

  // Each waits for the server -- a name can be refused -- but only for the
  // one request: the answer goes straight into the rail, and the full folder
  // list is fetched behind it instead of in front of it.

  /** Forget every cached list of a folder that no longer exists under that name. */
  const forgetFolderLists = useCallback(
    (name: string) =>
      queryClient.removeQueries({ queryKey: qk.lists, predicate: (q) => listParamsOf(q.queryKey).folder === name }),
    [queryClient],
  );

  const createFolder = useCallback(
    async (name: string) => {
      const result = await apiCreateFolder(name, handleUnauthorized);
      if (!result.success) return result.message;
      const created = result.data;
      if (created?.name) {
        queryClient.setQueryData<WebmailFolder[]>(qk.folders, (prev) =>
          prev && !prev.some((f) => f.name === created.name)
            ? [
                ...prev,
                {
                  id: created.id ?? created.name,
                  name: created.name,
                  role: null,
                  totalEmails: 0,
                  unreadEmails: 0,
                  uidNext: 0,
                  uidValidity: 0,
                },
              ]
            : prev,
        );
      }
      void refreshFolders();
      toast(`Created ${name}`);
      return null;
    },
    [handleUnauthorized, queryClient, refreshFolders, toast],
  );

  const renameFolder = useCallback(
    async (folder: { id: string; name: string }, name: string) => {
      const result = await apiRenameFolder(folder.id, name, handleUnauthorized);
      if (!result.success) return result.message;
      // The server answers with the whole new folder list, subfolders included.
      if (Array.isArray(result.data?.folders)) queryClient.setQueryData(qk.folders, result.data.folders.map(toFolder));
      forgetFolderLists(folder.name);
      void refreshFolders();
      if (activeFolder === folder.name && result.data?.name) setFolder(result.data.name);
      toast(`Renamed to ${result.data?.name ?? name}`);
      return null;
    },
    [handleUnauthorized, queryClient, forgetFolderLists, refreshFolders, activeFolder, setFolder, toast],
  );

  const deleteFolder = useCallback(
    async (folder: { id: string; name: string }) => {
      const result = await apiDeleteFolder(folder.id, handleUnauthorized);
      if (!result.success) return result.message;
      queryClient.setQueryData<WebmailFolder[]>(qk.folders, (prev) => prev?.filter((f) => f.name !== folder.name));
      forgetFolderLists(folder.name);
      void refreshFolders();
      if (activeFolder === folder.name) setFolder('INBOX');
      toast(`Deleted ${folder.name}`);
      return null;
    },
    [handleUnauthorized, queryClient, forgetFolderLists, refreshFolders, activeFolder, setFolder, toast],
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
      runRemoval([id], 'discardDraft', null, (target) => apiDiscardDraft(target, handleUnauthorized), null, false);
    },
    [runRemoval, handleUnauthorized],
  );

  // --- Sending -------------------------------------------------------------------

  // Held in the OutboxProvider, above every page, so the undo window and its
  // Undo follow the person anywhere.
  const { send } = useOutbox();

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

  /** Back to Drafts, under a new id. Not held: the scheduler could send it during an Undo window. */
  const cancelScheduledSend = useCallback(
    async (id: string) => {
      runRemoval(
        [id],
        'cancelScheduled',
        draftsFolder,
        (target) => apiCancelScheduled(target, handleUnauthorized),
        null,
        false,
      );
    },
    [runRemoval, draftsFolder, handleUnauthorized],
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

  // The selection, limited to rows on screen. A row can leave while ticked --
  // unstarred in Starred, taken by the poll, hidden by the attachments pill --
  // and a bulk action must never reach a message the person cannot see.
  const shownSelectedIds = useMemo(() => {
    const shown = new Set(visibleMessages.map((m) => m.id));
    const kept = selectedIds.filter((id) => shown.has(id));
    return kept.length === selectedIds.length ? selectedIds : kept;
  }, [selectedIds, visibleMessages]);

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
    selectedIds: shownSelectedIds,
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
    aiWrite,
    summarize,
    signatureSeed,
  };
}

export type Mailbox = ReturnType<typeof useMailbox>;
