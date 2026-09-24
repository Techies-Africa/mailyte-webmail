'use client';

/**
 * The mailbox: every piece of state the inbox screen holds and every action
 * it can take, in one hook.
 *
 * This used to live inline in app/page.tsx, at 1,400 lines, next to the
 * markup. The redesign splits the screen into panes with their own
 * components, and they all need the same state -- so the state moved here
 * and the page became the wiring. Nothing about the behaviour changed in the
 * move: paging, server search, the delta poll, URL state, undo-send and the
 * Trash rules are the same code, re-homed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listAllContacts, displayName as contactName } from '@/lib/webmail/contacts';
import { useToast } from '@/components/ui/Toast';
import type {
  ComposeMode,
  WebmailContact,
  WebmailFolder,
  WebmailListItem,
  WebmailMessage,
  WebmailSettings,
} from '@/components/webmail/types';
import type { ComposePayload } from '@/components/webmail/compose/types';
import {
  listMessages,
  listFolders,
  getMessage,
  getThread,
  trashMessage as apiTrash,
  deleteForever as apiDeleteForever,
  star as apiStar,
  unstar as apiUnstar,
  moveMessage as apiMove,
  markRead as apiMarkRead,
  markUnread as apiMarkUnread,
  sendMessage as apiSend,
  aiCompose as apiAiCompose,
  aiSummarize as apiAiSummarize,
  saveDraft as apiSaveDraft,
  discardDraft as apiDiscardDraft,
  listContacts,
  getSettings,
  getCapabilities,
  listScheduled,
  cancelScheduled as apiCancelScheduled,
  createFolder as apiCreateFolder,
  renameFolder as apiRenameFolder,
  deleteFolder as apiDeleteFolder,
  blockSender as apiBlockSender,
} from '@/lib/webmail/client';
import type { ApiCapabilities, ScheduledMessage, SharedMailbox } from '@/lib/webmail/client';
import { formatSendAt } from '@/lib/webmail/scheduleTimes';
import {
  FALLBACK_FOLDERS,
  foldersFingerprint,
  toContact,
  toFolder,
  toSettings,
  toListItem,
  toMessage,
} from '@/lib/webmail/adapters';

/**
 * Delta poll interval (PRD P4). A tick is one folders call that transfers no
 * message content; only when a folder's uid_next has moved does anything
 * reload.
 */
const POLL_MS = 45_000;

/** One page. */
export const PAGE_SIZE = 50;

/** The most rows "mark all read" will touch in one go. */
const MARK_ALL_CAP = 1000;

/** Fallback window when the preference has not loaded yet. */
const DEFAULT_UNDO_SECONDS = 5;

/** Starred is a keyword view over the inbox, not an IMAP folder. */
export const STARRED_VIEW = '__starred__';

export type ListFilter = 'all' | 'unread' | 'starred' | 'attachments';
export type SearchScope = 'folder' | 'all';

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
 * Native history rather than router.push(): this screen holds the whole
 * mailbox in component state, and re-running the route for what is really an
 * in-page selection would throw it away. pushState feeds the address bar and
 * Back without disturbing the tree; the popstate listener restores state.
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

export function useMailbox() {
  const router = useRouter();
  const { toast } = useToast();

  const [displayEmail, setDisplayEmail] = useState('');
  const [folders, setFolders] = useState<WebmailFolder[]>(FALLBACK_FOLDERS);
  const [activeFolder, setActiveFolder] = useState(() => readUrlState().folder ?? 'INBOX');
  const [messages, setMessages] = useState<WebmailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [openMessage, setOpenMessage] = useState<WebmailMessage | null>(null);
  const [thread, setThread] = useState<WebmailListItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Until the first authenticated request comes back, we do not know whether
  // there is a session at all. Rendering the mailbox before then meant a
  // signed-out visitor saw the full interface, then a redirect.
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `search` is what's typed; `activeSearch` is what the server was asked
  // for. Keeping them apart is what makes search a submit rather than a
  // keystroke-per-request against IMAP.
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('folder');
  const [filter, setFilterState] = useState<ListFilter>('all');
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [contacts, setContacts] = useState<WebmailContact[]>([]);
  const [settings, setSettings] = useState<WebmailSettings | null>(null);
  const [capabilities, setCapabilities] = useState<ApiCapabilities['capabilities'] | null>(null);
  const [sharedMailboxes, setSharedMailboxes] = useState<SharedMailbox[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const aiAvailable = capabilities?.ai === true;
  const scheduleAvailable = capabilities?.scheduled_send === true;
  const calendarAvailable = capabilities?.calendar === true;
  const contactsAvailable = capabilities?.contacts === true;

  // The last folder fingerprint the list was built from. The poll compares
  // against this and reloads only on a real change.
  const syncTokenRef = useRef<string>('');

  const activeFolderMeta = folders.find((f) => f.name === activeFolder) ?? null;
  const inTrash = activeFolderMeta?.role === 'trash';
  const inJunk = activeFolderMeta?.role === 'junk';

  const handleUnauthorized = useCallback(() => {
    // Deliberately does NOT set sessionChecked: the gate stays closed so the
    // mailbox never paints on the way out to the login page.
    router.push('/login');
  }, [router]);

  // --- Loading ---------------------------------------------------------------

  const loadMessages = useCallback(
    async (
      folder: string,
      options: {
        silent?: boolean;
        offset?: number;
        search?: string;
        scope?: SearchScope;
        filter?: ListFilter;
      } = {},
    ) => {
      const {
        silent = false,
        offset: pageOffset = 0,
        search: query = '',
        scope = 'folder',
        filter: listFilter = 'all',
      } = options;
      if (!silent) setLoadingList(true);
      setError(null);

      // Starred is a keyword view over the inbox: SEARCH FLAGGED, on the
      // server. The "attachments" pill has no server counterpart and is
      // applied to the page below.
      const isStarredView = folder === STARRED_VIEW;
      const allMail = query !== '' && scope === 'all';

      const result = await listMessages(
        {
          folder: allMail ? null : isStarredView ? 'INBOX' : folder,
          search: query || undefined,
          offset: pageOffset,
          limit: PAGE_SIZE,
          unread: listFilter === 'unread' || undefined,
          starred: isStarredView || listFilter === 'starred' || undefined,
        },
        handleUnauthorized,
      );

      if (!result.success) {
        if (!silent) setError(result.message);
        setLoadingList(false);
        return;
      }

      const items = result.data.messages.map(toListItem);

      // The request was accepted, so a valid session exists -- only now is
      // it safe to paint the mailbox.
      setSessionChecked(true);
      setMessages(items);
      setTotal(result.data.total);
      setOffset(pageOffset);
      setLastSyncAt(new Date());
      if (!silent) setLoadingList(false);
    },
    [handleUnauthorized],
  );

  /**
   * Fetch the folder list, and report whether anything in the mailbox moved
   * since the last time. This one call is both the sidebar's data and the
   * change signal the poll runs on (P2 + P4).
   */
  const loadFolders = useCallback(async (): Promise<{ changed: boolean }> => {
    const result = await listFolders(handleUnauthorized);
    if (!result.success) return { changed: false };

    const next = result.data.map(toFolder);
    setFolders(next);

    const fingerprint = foldersFingerprint(next);
    const changed = syncTokenRef.current !== '' && syncTokenRef.current !== fingerprint;
    syncTokenRef.current = fingerprint;

    return { changed };
  }, [handleUnauthorized]);

  /** When each message in the Scheduled folder is due. */
  const loadScheduled = useCallback(async () => {
    const result = await listScheduled(handleUnauthorized);
    setScheduled(result.success ? (result.data?.messages ?? []) : []);
  }, [handleUnauthorized]);

  useEffect(() => {
    void loadMessages(activeFolder, { search: activeSearch, scope: searchScope, filter });
    void loadFolders();
    void loadScheduled();
    // A placeholder only, so the profile chip is not blank on first paint.
    // The authoritative address arrives from /capabilities below.
    const raw = sessionStorage.getItem('mailyte_mailbox_display');
    if (raw) {
      try {
        setDisplayEmail(JSON.parse(raw).email_address ?? '');
      } catch {
        // display-only, safe to ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolder, activeSearch, searchScope, filter]);

  // Autocomplete suggestions, settings and capabilities: loaded once.
  useEffect(() => {
    void listContacts(handleUnauthorized).then((result) => {
      if (result.success && Array.isArray(result.data)) setContacts(result.data.map(toContact));
    });
    // Three sources, merged in this order and de-duplicated by address:
    // saved cards, the directory, then everyone harvested from headers. A
    // curated record outranks a generated one; the harvested list is the only
    // one that knows who you actually write to, so it is never dropped.
    void listAllContacts(handleUnauthorized).then((books) => {
      const flatten = (entries: typeof books, wanted: 'saved' | 'directory') =>
        entries
          .filter((entry) => (entry.book.read_only ? 'directory' : 'saved') === wanted)
          .flatMap((entry) =>
            entry.contacts.flatMap((contact) =>
              contact.emails.map((email) => ({
                name: contactName(contact),
                email: email.address,
                source: wanted,
              })),
            ),
          )
          .filter((entry) => entry.email);

      const ranked = [...flatten(books, 'saved'), ...flatten(books, 'directory')];
      if (ranked.length === 0) return;

      setContacts((current) => {
        const seen = new Set<string>();
        const merged: WebmailContact[] = [];
        for (const entry of [...ranked, ...current]) {
          const key = entry.email.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(entry);
        }
        return merged;
      });
    });
    void getSettings(handleUnauthorized).then((result) => {
      if (result.success && result.data) setSettings(toSettings(result.data));
    });
    void getCapabilities(handleUnauthorized).then((result) => {
      if (!result.success || !result.data) return;
      setCapabilities(result.data.capabilities);
      setSharedMailboxes(
        Array.isArray(result.data.shared_mailboxes) ? result.data.shared_mailboxes : [],
      );
      // The signed-in address according to the SERVER, which is the only
      // thing that knows whose session this actually is.
      if (result.data.email_address) {
        setDisplayEmail(result.data.email_address);
        try {
          sessionStorage.setItem(
            'mailyte_mailbox_display',
            JSON.stringify({ email_address: result.data.email_address }),
          );
        } catch {
          // Storage unavailable (private mode); the state above is what renders.
        }
      }
    });
  }, [handleUnauthorized]);

  /**
   * Delta sync (P4). Paused while the tab is hidden, and run once on
   * becoming visible again.
   */
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const { changed } = await loadFolders();
      if (changed) {
        void loadMessages(activeFolder, {
          silent: true,
          offset,
          search: activeSearch,
          scope: searchScope,
          filter,
        });
        void loadScheduled();
      } else {
        setLastSyncAt(new Date());
      }
    };

    const interval = setInterval(() => void tick(), POLL_MS);
    const onVisible = () => void tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeFolder, activeSearch, searchScope, filter, offset, loadFolders, loadMessages, loadScheduled]);

  const reloadList = useCallback(
    (silent = true) =>
      loadMessages(activeFolder, {
        silent,
        offset,
        search: activeSearch,
        scope: searchScope,
        filter,
      }),
    [activeFolder, offset, activeSearch, searchScope, filter, loadMessages],
  );

  const refreshAll = useCallback(() => {
    void reloadList(false);
    void loadFolders();
    void loadScheduled();
  }, [reloadList, loadFolders, loadScheduled]);

  // --- Navigation --------------------------------------------------------------

  const setFolder = useCallback((folder: string) => {
    setActiveFolder(folder);
    setSelectedIds([]);
    setOpenMessage(null);
    setThread([]);
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
    setOpenMessage(null);
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

  const goToPage = useCallback(
    (nextOffset: number) => {
      setSelectedIds([]);
      void loadMessages(activeFolder, {
        offset: nextOffset,
        search: activeSearch,
        scope: searchScope,
        filter,
      });
    },
    [activeFolder, activeSearch, searchScope, filter, loadMessages],
  );

  // --- Reading -----------------------------------------------------------------

  /**
   * Open a message in the reading pane. Returns the loaded message, or a
   * `draft` marker when the row is a draft -- the caller resumes writing it
   * instead, because an unsent message has nothing to read.
   */
  const open = useCallback(
    async (
      item: WebmailListItem,
    ): Promise<{ kind: 'message' } | { kind: 'draft'; message: WebmailMessage } | { kind: 'error' }> => {
      setThread([]);
      setLoadingMessage(true);
      try {
        const result = await getMessage(item.id, handleUnauthorized);
        if (!result.success || !result.data) {
          setError(result.success ? 'That message could not be loaded.' : result.message);
          return { kind: 'error' };
        }

        const message = toMessage(result.data);
        if (item.isDraft || item.folder === 'Drafts') {
          return { kind: 'draft', message };
        }

        setOpenMessage(message);
        pushUrlState(item.folder || activeFolder, item.id);
        if (!result.data.is_read) {
          void apiMarkRead(item.id, handleUnauthorized);
          setMessages((prev) => prev.map((m) => (m.id === item.id ? { ...m, isRead: true } : m)));
          setFolders((prev) =>
            prev.map((f) =>
              f.name === (item.folder || activeFolder)
                ? { ...f, unreadEmails: Math.max(0, f.unreadEmails - 1) }
                : f,
            ),
          );
        }

        // The conversation, fetched after the message so the body paints
        // immediately (F1).
        const threadResult = await getThread(item.id, handleUnauthorized);
        if (threadResult.success && Array.isArray(threadResult.data)) {
          setThread(threadResult.data.map(toListItem));
        }
        return { kind: 'message' };
      } finally {
        setLoadingMessage(false);
      }
    },
    [handleUnauthorized, activeFolder],
  );

  const close = useCallback(() => {
    setOpenMessage(null);
    setThread([]);
    pushUrlState(activeFolder, null);
  }, [activeFolder]);

  const loadThreadMessage = useCallback(
    async (id: string) => {
      const result = await getMessage(id, handleUnauthorized);
      return result.success && result.data ? toMessage(result.data) : null;
    },
    [handleUnauthorized],
  );

  // Back / Forward: pushUrlState changes the address bar without telling
  // React, so history navigation has to be applied to state here.
  useEffect(() => {
    const onPopState = () => {
      const { folder, id } = readUrlState();
      const nextFolder = folder ?? 'INBOX';
      setActiveFolder((prev) => (prev === nextFolder ? prev : nextFolder));
      if (!id) {
        setOpenMessage(null);
        return;
      }
      setOpenMessage((prev) => (prev && prev.id === id ? prev : null));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Deep link: a URL carrying ?id= opens that message once its list loaded.
  // Latches so closing the message does not immediately reopen it.
  const restoredDeepLink = useRef(false);
  useEffect(() => {
    if (restoredDeepLink.current || openMessage) return;
    const { id } = readUrlState();
    if (!id) {
      restoredDeepLink.current = true;
      return;
    }
    const item = messages.find((m) => m.id === id);
    if (!item) return;
    restoredDeepLink.current = true;
    void open(item);
  }, [messages, openMessage, open]);

  // --- Actions on messages -----------------------------------------------------

  const removeFromList = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setMessages((prev) => prev.filter((m) => !set.has(m.id)));
    setSelectedIds((prev) => prev.filter((id) => !set.has(id)));
    setOpenMessage((prev) => (prev && set.has(prev.id) ? null : prev));
    setTotal((prev) => Math.max(0, prev - ids.length));
  }, []);

  const toggleStar = useCallback(
    async (id: string) => {
      const target = messages.find((m) => m.id === id);
      const currentlyStarred = target ? target.isStarred : (openMessage?.isStarred ?? false);
      const result = await (currentlyStarred ? apiUnstar : apiStar)(id, handleUnauthorized);
      if (!result.success) {
        toast(result.message, { tone: 'error' });
        return;
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, isStarred: !currentlyStarred } : m)),
      );
      setOpenMessage((prev) =>
        prev && prev.id === id ? { ...prev, isStarred: !currentlyStarred } : prev,
      );
    },
    [messages, openMessage, handleUnauthorized, toast],
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
      removeFromList(ids);
      void loadFolders();
    },
    [removeFromList, loadFolders],
  );

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
      const inbox = folders.find((f) => f.role === 'inbox')?.name ?? 'INBOX';
      const n = await runOnIds(ids, (id) => apiMove(id, inbox, handleUnauthorized), afterMove);
      if (n > 0) toast('Moved to Inbox');
    },
    [folders, runOnIds, handleUnauthorized, afterMove, toast],
  );

  const setRead = useCallback(
    async (ids: string[], read: boolean) => {
      const action = read ? apiMarkRead : apiMarkUnread;
      await runOnIds(ids, (id) => action(id, handleUnauthorized), (done) => {
        const set = new Set(done);
        setMessages((prev) => prev.map((m) => (set.has(m.id) ? { ...m, isRead: read } : m)));
        setOpenMessage((prev) => (prev && set.has(prev.id) ? { ...prev, isRead: read } : prev));
        setSelectedIds([]);
        void loadFolders();
      });
    },
    [runOnIds, handleUnauthorized, loadFolders],
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
    if (activeFolder === STARRED_VIEW || markingAllRead) return;
    setMarkingAllRead(true);
    try {
      const ids: string[] = [];
      let page = 0;
      while (ids.length < MARK_ALL_CAP) {
        const result = await listMessages(
          { folder: activeFolder, unread: true, limit: 200, offset: page },
          handleUnauthorized,
        );
        if (!result.success) {
          toast(result.message, { tone: 'error' });
          return;
        }
        ids.push(...result.data.messages.map((m) => m.id));
        if (!result.data.has_more) break;
        page += 200;
      }
      if (ids.length === 0) {
        toast('Nothing unread here', { tone: 'info' });
        return;
      }
      let done = 0;
      for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        const results = await Promise.all(chunk.map((id) => apiMarkRead(id, handleUnauthorized)));
        done += results.filter((r) => r.success).length;
      }
      setMessages((prev) => prev.map((m) => ({ ...m, isRead: true })));
      void loadFolders();
      toast(
        done >= MARK_ALL_CAP
          ? `Marked ${done} as read — run it again for the rest`
          : `Marked ${plural(done, 'message')} as read`,
      );
    } finally {
      setMarkingAllRead(false);
    }
  }, [activeFolder, markingAllRead, handleUnauthorized, loadFolders, toast]);

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

  // --- Folders -------------------------------------------------------------------

  const createFolder = useCallback(
    async (name: string) => {
      const result = await apiCreateFolder(name, handleUnauthorized);
      if (!result.success) return result.message;
      await loadFolders();
      toast(`Created ${name}`);
      return null;
    },
    [handleUnauthorized, loadFolders, toast],
  );

  const renameFolder = useCallback(
    async (folder: WebmailFolder, name: string) => {
      const result = await apiRenameFolder(folder.id, name, handleUnauthorized);
      if (!result.success) return result.message;
      await loadFolders();
      if (activeFolder === folder.name && result.data?.name) setFolder(result.data.name);
      toast(`Renamed to ${result.data?.name ?? name}`);
      return null;
    },
    [handleUnauthorized, loadFolders, activeFolder, setFolder, toast],
  );

  const deleteFolder = useCallback(
    async (folder: WebmailFolder) => {
      const result = await apiDeleteFolder(folder.id, handleUnauthorized);
      if (!result.success) return result.message;
      await loadFolders();
      if (activeFolder === folder.name) setFolder('INBOX');
      toast(`Deleted ${folder.name}`);
      return null;
    },
    [handleUnauthorized, loadFolders, activeFolder, setFolder, toast],
  );

  // --- Drafts --------------------------------------------------------------------

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
      void loadFolders();
      if (activeFolder === 'Drafts') void reloadList();
      return result.data.id;
    },
    [handleUnauthorized, loadFolders, activeFolder, reloadList],
  );

  const discardDraft = useCallback(
    async (id: string) => {
      await apiDiscardDraft(id, handleUnauthorized);
      void loadFolders();
      if (activeFolder === 'Drafts') void reloadList();
    },
    [handleUnauthorized, loadFolders, activeFolder, reloadList],
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

      if (payload.sendAt) {
        toast(`Scheduled to send ${formatSendAt(new Date(payload.sendAt))}`);
        void reloadList();
        void loadFolders();
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
      void reloadList();
      void loadFolders();
    },
    [handleUnauthorized, toast, reloadList, loadFolders, loadScheduled],
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
      setOpenMessage((prev) => (prev && prev.id === id ? null : prev));
      toast('Send cancelled — the message is in your drafts');
      void loadScheduled();
      void loadFolders();
      void reloadList();
    },
    [handleUnauthorized, toast, loadScheduled, loadFolders, reloadList],
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

  const summarize = useCallback(
    async (id: string) => {
      const result = await apiAiSummarize(id, handleUnauthorized);
      if (!result.success) throw new Error(result.message);
      return result.data.summary;
    },
    [handleUnauthorized],
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
    offset,
    loadingList,
    error,
    lastSyncAt,
    refreshAll,
    goToPage,
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
