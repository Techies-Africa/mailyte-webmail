'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import WebmailSidebar, { STARRED_VIEW } from '@/components/webmail/WebmailSidebar';
import WebmailHeader from '@/components/webmail/WebmailHeader';
import WebmailList from '@/components/webmail/WebmailList';
import WebmailToolbar from '@/components/webmail/WebmailToolbar';
import WebmailMessageView from '@/components/webmail/WebmailMessageView';
import WebmailCompose, { type ComposePayload } from '@/components/webmail/WebmailCompose';
import WebmailEmptyState from '@/components/webmail/WebmailEmptyState';
import ConfirmModal from '@/components/webmail/modals/ConfirmModal';
import WebmailUndoToast from '@/components/webmail/WebmailUndoToast';
import WebmailShortcutHelp from '@/components/webmail/WebmailShortcutHelp';
import {
  useKeyboardShortcuts,
  useUnreadTitle,
} from '@/lib/webmail/useKeyboardShortcuts';
import MoveEmailModal from '@/components/webmail/modals/MoveEmailModal';
import type {
  ComposeMode,
  WebmailContact,
  WebmailFolder,
  WebmailSettings,
  WebmailListItem,
  WebmailMessage,
} from '@/components/webmail/types';
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
  attachmentUrl,
  saveDraft as apiSaveDraft,
  discardDraft as apiDiscardDraft,
  listContacts,
  getSettings,
  createFolder as apiCreateFolder,
  logout as apiLogout,
} from '@/lib/webmail/client';
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
 * Delta poll interval (PRD P4, phase-04's realtime rules). This was 10s and
 * each tick refetched three folders IN FULL -- roughly 1,500 whole messages
 * a minute per open tab. A tick is now a single folders call that transfers
 * no message content at all, and only when a folder's uid_next has actually
 * moved does anything reload.
 */
const POLL_MS = 45_000;

/** One page. The old list had no page size because it had no paging. */
const PAGE_SIZE = 50;

/**
 * Fallback window when the preference has not loaded yet. The PRD's SS12
 * answer fixed undo-send at always-on/10s; the owner changed it to
 * off-by-default/5s, configurable per mailbox (settings > Composing).
 */
const DEFAULT_UNDO_SECONDS = 5;

function formatRelativeSync(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function splitAddresses(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function WebmailInboxPage() {
  const router = useRouter();
  const [displayEmail, setDisplayEmail] = useState('');
  const [folders, setFolders] = useState<WebmailFolder[]>(FALLBACK_FOLDERS);
  const [activeFolder, setActiveFolder] = useState('INBOX');
  const [messages, setMessages] = useState<WebmailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [openMessage, setOpenMessage] = useState<WebmailMessage | null>(null);
  const [thread, setThread] = useState<WebmailListItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Until the first authenticated request comes back, we do not know whether
  // there is a session at all. Rendering the mailbox before then meant a
  // signed-out visitor saw the full interface, then "not logged in", then a
  // redirect -- looking briefly as though someone else's mail had loaded.
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // `search` is what's typed; `activeSearch` is what the server was asked
  // for. Keeping them apart is what makes search a submit rather than a
  // keystroke-per-request against IMAP.
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [isMobileView, setIsMobileView] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [pendingDeleteForever, setPendingDeleteForever] = useState<WebmailListItem | null>(null);
  const [showBulkMove, setShowBulkMove] = useState(false);
  const [pendingSend, setPendingSend] = useState<{
    subject: string;
    until: number;
    /** Kept so Undo can put the message back exactly as it was. */
    payload: ComposePayload;
    /** The compose context the message came from, so Undo restores it exactly. */
    context: { mode: ComposeMode; replyTo?: WebmailMessage; draftId?: string };
  } | null>(null);
  const [contacts, setContacts] = useState<WebmailContact[]>([]);
  const [settings, setSettings] = useState<WebmailSettings | null>(null);
  // The last folder fingerprint the list was built from. The poll compares
  // against this and reloads only on a real change.
  const syncTokenRef = useRef<string>('');
  const [compose, setCompose] = useState<{
    open: boolean;
    mode: ComposeMode;
    replyTo?: WebmailMessage;
    initialBody?: string;
    /** Set when resuming an existing draft, so saving supersedes it. */
    draftId?: string;
    /** The draft's own header fields, restored into the compose window. */
    resumed?: { to: string; cc: string; bcc: string; subject: string };
  }>({ open: false, mode: 'compose' });

  // Mirrors `compose` for the send closure, which needs the mode/replyTo the
  // message was written in without re-creating itself on every keystroke.
  const composeRef = useRef(compose);
  useEffect(() => {
    composeRef.current = compose;
  }, [compose]);

  const activeFolderMeta = folders.find((f) => f.name === activeFolder) ?? null;
  const inTrash = activeFolderMeta?.role === 'trash';

  const handleUnauthorized = useCallback(() => {
    // Deliberately does NOT set sessionChecked: the gate stays closed so the
    // mailbox never paints on the way out to the login page.
    router.push('/webmail/login');
  }, [router]);

  const loadMessages = useCallback(
    async (folder: string, options: { silent?: boolean; offset?: number; search?: string } = {}) => {
      const { silent = false, offset: pageOffset = 0, search: query = '' } = options;
      if (!silent) setLoadingList(true);
      setError(null);

      // Starred is a keyword view, not a folder. IMAP can answer it directly
      // (SEARCH FLAGGED) but the API's filter vocabulary is folder+search, so
      // it stays an account-wide fetch filtered here -- honest about being
      // the one view whose count is page-local.
      const isStarredView = folder === STARRED_VIEW;

      const result = await listMessages(
        {
          folder: isStarredView ? null : folder,
          search: query || undefined,
          offset: pageOffset,
          limit: PAGE_SIZE,
        },
        handleUnauthorized,
      );

      if (!result.success) {
        if (!silent) setError(result.message);
        setLoadingList(false);
        return;
      }

      const items = result.data.messages
        .map(toListItem)
        .filter((m) => (isStarredView ? m.isStarred : true));

      // The request was accepted, so a valid session exists -- only now is
      // it safe to paint the mailbox.
      setSessionChecked(true);
      setMessages(items);
      setTotal(isStarredView ? items.length : result.data.total);
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

  useEffect(() => {
    void loadMessages(activeFolder, { search: activeSearch });
    void loadFolders();
    const raw = sessionStorage.getItem('mailyte_mailbox_display');
    if (raw) {
      try {
        setDisplayEmail(JSON.parse(raw).email_address ?? '');
      } catch {
        // display-only, safe to ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFolder, activeSearch]);

  // Autocomplete suggestions (C2). Loaded once -- they are a convenience,
  // and re-harvesting them on every folder change would cost two folder
  // reads for no benefit.
  useEffect(() => {
    void listContacts(handleUnauthorized).then((result) => {
      if (result.success) setContacts(result.data.map(toContact));
    });
    void getSettings(handleUnauthorized).then((result) => {
      if (result.success) setSettings(toSettings(result.data));
    });
  }, [handleUnauthorized]);

  useEffect(() => {
    const checkMobileView = () => {
      setIsMobileView(window.innerWidth < 768);
      setShowSidebar(window.innerWidth >= 768);
    };
    checkMobileView();
    window.addEventListener('resize', checkMobileView);
    return () => window.removeEventListener('resize', checkMobileView);
  }, []);

  /**
   * Delta sync (P4). Each tick asks only for folder status; the message list
   * is refetched only when that status says something actually changed.
   * Paused while the tab is hidden, and run once on becoming visible again
   * so returning to the tab is immediately up to date.
   */
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const { changed } = await loadFolders();
      if (changed) {
        void loadMessages(activeFolder, { silent: true, offset, search: activeSearch });
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
  }, [activeFolder, activeSearch, offset, loadFolders, loadMessages]);

  const refreshAll = useCallback(() => {
    void loadMessages(activeFolder, { offset, search: activeSearch });
    void loadFolders();
  }, [activeFolder, activeSearch, offset, loadMessages, loadFolders]);

  const handleFolderChange = (folder: string) => {
    setActiveFolder(folder);
    setSelectedIds([]);
    setOpenMessage(null);
    setSearch('');
    setActiveSearch('');
    setOffset(0);
    if (isMobileView) setShowSidebar(false);
  };

  /** Search runs on the server, across every folder (P5). */
  const runSearch = useCallback((query: string) => {
    setActiveSearch(query.trim());
    setOffset(0);
    setSelectedIds([]);
    setOpenMessage(null);
  }, []);

  const goToPage = useCallback(
    (nextOffset: number) => {
      setSelectedIds([]);
      setOpenMessage(null);
      void loadMessages(activeFolder, { offset: nextOffset, search: activeSearch });
    },
    [activeFolder, activeSearch, loadMessages],
  );

  const handleOpen = useCallback(
    async (item: WebmailListItem) => {
      setOpenMessage(null);
      setThread([]);
      setLoadingMessage(true);
      setCompose({ open: false, mode: 'compose' });
      try {
        const result = await getMessage(item.id, handleUnauthorized);
        if (!result.success) {
          setError(result.message);
          return;
        }

        // Opening a draft resumes writing it. Rendering an unsent message in
        // a read-only reading pane is the behaviour every mail client
        // deliberately does not have -- there is nothing to read, and no way
        // to finish it (F6).
        if (item.isDraft || item.folder === 'Drafts') {
          const message = toMessage(result.data);
          setCompose({
            open: true,
            mode: 'compose',
            initialBody: message.body,
            draftId: item.id,
            resumed: {
              to: message.to.map((p) => p.email).join(', '),
              cc: message.cc.map((p) => p.email).join(', '),
              bcc: message.bcc.map((p) => p.email).join(', '),
              subject: message.subject === '(no subject)' ? '' : message.subject,
            },
          });
          return;
        }

        setOpenMessage(toMessage(result.data));
        if (!result.data.is_read) {
          void apiMarkRead(item.id, handleUnauthorized);
          setMessages((prev) => prev.map((m) => (m.id === item.id ? { ...m, isRead: true } : m)));
        }

        // The conversation, if there is one. Fetched after the message so
        // the body paints immediately -- a thread that turns out to be a
        // single message costs the reader nothing (F1).
        const threadResult = await getThread(item.id, handleUnauthorized);
        if (threadResult.success) {
          setThread(threadResult.data.map(toListItem));
        }
      } finally {
        setLoadingMessage(false);
      }
    },
    [handleUnauthorized],
  );

  const removeFromList = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      setMessages((prev) => prev.filter((m) => !set.has(m.id)));
      setSelectedIds((prev) => prev.filter((id) => !set.has(id)));
      setOpenMessage((prev) => (prev && set.has(prev.id) ? null : prev));
    },
    [],
  );

  const toggleStar = useCallback(
    async (id: string) => {
      const target = messages.find((m) => m.id === id);
      const currentlyStarred = target ? target.isStarred : (openMessage?.isStarred ?? false);
      const result = await (currentlyStarred ? apiUnstar : apiStar)(id, handleUnauthorized);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, isStarred: !currentlyStarred } : m)),
      );
      setOpenMessage((prev) =>
        prev && prev.id === id ? { ...prev, isStarred: !currentlyStarred } : prev,
      );
    },
    [messages, openMessage, handleUnauthorized],
  );

  const runOnIds = useCallback(
    async (
      ids: string[],
      action: (id: string) => Promise<{ success: boolean; message?: string }>,
      onDone: (ids: string[]) => void,
    ) => {
      const results = await Promise.all(ids.map(action));
      const failed = results.find((r) => !r.success);
      if (failed) setError(failed.message ?? 'Some messages could not be updated');
      const succeeded = ids.filter((_, i) => results[i].success);
      onDone(succeeded);
    },
    [],
  );

  const archive = useCallback(
    (ids: string[]) =>
      runOnIds(ids, (id) => apiMove(id, 'Archive', handleUnauthorized), removeFromList),
    [runOnIds, handleUnauthorized, removeFromList],
  );

  const trash = useCallback(
    (ids: string[]) => runOnIds(ids, (id) => apiTrash(id, handleUnauthorized), removeFromList),
    [runOnIds, handleUnauthorized, removeFromList],
  );

  const deleteForever = useCallback(
    (ids: string[]) =>
      runOnIds(ids, (id) => apiDeleteForever(id, handleUnauthorized), removeFromList),
    [runOnIds, handleUnauthorized, removeFromList],
  );

  const move = useCallback(
    (ids: string[], folder: string) =>
      runOnIds(ids, (id) => apiMove(id, folder, handleUnauthorized), removeFromList),
    [runOnIds, handleUnauthorized, removeFromList],
  );

  /**
   * Mark as spam = file into Junk (PRD SS12 answer 2: per-mailbox filing in
   * v1, no org-wide suppression). The folder is guaranteed to exist -- it is
   * one of the six Dovecot provisions -- and move() would create it anyway.
   */
  const markSpam = useCallback(
    (ids: string[]) => runOnIds(ids, (id) => apiMove(id, 'Junk', handleUnauthorized), removeFromList),
    [runOnIds, handleUnauthorized, removeFromList],
  );

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

      if (!result.success) {
        // Autosave failing is worth saying, but not worth an error banner
        // that interrupts typing -- the compose window shows the state.
        return null;
      }

      // A new draft changes the Drafts count in the sidebar.
      void loadFolders();
      return result.data.id;
    },
    [handleUnauthorized, loadFolders],
  );

  const discardDraft = useCallback(
    async (id: string) => {
      await apiDiscardDraft(id, handleUnauthorized);
      void loadFolders();
      if (activeFolder === 'Drafts') {
        void loadMessages(activeFolder, { silent: true, offset, search: activeSearch });
      }
    },
    [handleUnauthorized, loadFolders, loadMessages, activeFolder, offset, activeSearch],
  );

  const setRead = useCallback(
    async (ids: string[], read: boolean) => {
      const action = read ? apiMarkRead : apiMarkUnread;
      await runOnIds(ids, (id) => action(id, handleUnauthorized), (done) => {
        const set = new Set(done);
        setMessages((prev) => prev.map((m) => (set.has(m.id) ? { ...m, isRead: read } : m)));
        setSelectedIds([]);
      });
    },
    [runOnIds, handleUnauthorized],
  );

  /**
   * Undo send (PRD C4, and SS12's answer: fixed at 10 seconds).
   *
   * A client-side hold, not a server-side recall: the message has simply not
   * been handed to Postfix yet. Honest and simple -- once the window closes
   * the message is genuinely gone, and nothing on screen offers an Undo that
   * would no longer work. True queue-based recall is out of scope.
   *
   * The compose window closes immediately and the toast owns the message
   * from there, which is what every client that has this feature does:
   * keeping compose open for ten seconds to "confirm" would make the delay
   * feel like latency instead of a safety net.
   */
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
        },
        payload.attachments ?? [],
        handleUnauthorized,
      );

      if (!result.success) {
        // The message never left. Say so where the user is now -- the
        // compose window is long closed.
        setError(`"${payload.subject || '(no subject)'}" was not sent: ${result.message}`);
        return;
      }

      // The message is away either way. When the Sent copy has not landed
      // yet the API has queued a retry, and saying so beats a bare "Sent"
      // over an empty Sent folder (F4).
      if (result.data && result.data.filed_to_sent === false) {
        setNotice('Sent — filing to your Sent folder is still in progress.');
      }
      void loadMessages(activeFolder, { silent: true, offset, search: activeSearch });
      void loadFolders();
    },
    [activeFolder, activeSearch, offset, handleUnauthorized, loadMessages, loadFolders],
  );

  const cancelUndo = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;

    setPendingSend((current) => {
      // Put the message back in front of the user, exactly as it was.
      if (current) {
        setCompose({
          open: true,
          mode: current.context.mode,
          replyTo: current.context.replyTo,
          initialBody: current.payload.body,
          draftId: current.context.draftId,
          resumed: {
            to: current.payload.to,
            cc: current.payload.cc,
            bcc: current.payload.bcc,
            subject: current.payload.subject,
          },
        });
      }
      return null;
    });
  }, []);

  const send = useCallback(
    async (payload: ComposePayload) => {
      // Undo-send is opt-in (settings > Composing). With it off there is no
      // hold and no toast -- Send means sent, which is what someone who
      // turned it off is asking for.
      if (!settings?.undoSendEnabled) {
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
        context: {
          mode: composeRef.current.mode,
          replyTo: composeRef.current.replyTo,
          draftId: composeRef.current.draftId,
        },
      });

      // Resolves immediately so compose closes; the toast holds the message.
      return { success: true as const };
    },
    [deliver, settings],
  );

  const aiWrite = useCallback(
    async (instruction: string, existingBody: string) => {
      const result = await apiAiCompose(instruction, existingBody, handleUnauthorized);
      if (!result.success) throw new Error(result.message);
      return result.data.draft;
    },
    [handleUnauthorized],
  );

  const summarize = useCallback(async () => {
    if (!openMessage) throw new Error('No message selected');
    const result = await apiAiSummarize(openMessage.id, handleUnauthorized);
    if (!result.success) throw new Error(result.message);
    return result.data.summary;
  }, [openMessage, handleUnauthorized]);

  const logout = async () => {
    await apiLogout();
    sessionStorage.removeItem('mailyte_mailbox_display');
    router.push('/webmail/login');
  };

  // No client-side filtering any more: `messages` IS the server's answer,
  // whether that's a folder page or a search across every folder (P5).
  const visibleMessages = messages;

  /**
   * Unread across the whole mailbox, from the folder counts -- not a count
   * of unread rows on the current page, which is what it used to be and
   * which quietly under-reported the moment paging existed.
   */
  const unreadCount = useMemo(
    () => folders.reduce((sum, f) => sum + (f.role === 'trash' ? 0 : f.unreadEmails), 0),
    [folders],
  );

  const allSelected = visibleMessages.length > 0 && selectedIds.length === visibleMessages.length;
  const rangeStart = messages.length === 0 ? 0 : offset + 1;
  const rangeEnd = offset + messages.length;
  const hasPrev = offset > 0;
  const hasNext = rangeEnd < total;

  /**
   * Create a real IMAP folder (S5). A "label" in this product IS a folder --
   * the demo's four hardcoded labels and its create-folder modal that
   * created nothing are what this replaces.
   */
  const createFolder = useCallback(
    async (name: string) => {
      const result = await apiCreateFolder(name, handleUnauthorized);
      if (!result.success) return result.message;
      await loadFolders();
      return null;
    },
    [handleUnauthorized, loadFolders],
  );

  // S6: unread in the document title, from the mailbox's real unread total.
  useUnreadTitle(unreadCount);

  // S4. Handlers are only passed for actions that make sense right now --
  // no reply key when nothing is open, no archive key inside Trash -- so a
  // key that does nothing is never bound rather than silently ignored.
  const selectedIndex = openMessage
    ? visibleMessages.findIndex((m) => m.id === openMessage.id)
    : -1;

  const step = useCallback(
    (delta: number) => {
      if (visibleMessages.length === 0) return;
      const next = selectedIndex === -1 ? 0 : selectedIndex + delta;
      const target = visibleMessages[Math.max(0, Math.min(visibleMessages.length - 1, next))];
      if (target) void handleOpen(target);
    },
    [visibleMessages, selectedIndex, handleOpen],
  );

  const { helpOpen, setHelpOpen } = useKeyboardShortcuts(
    {
      compose: () => setCompose({ open: true, mode: 'compose' }),
      reply: openMessage ? () => openCompose('reply') : undefined,
      replyAll: openMessage ? () => openCompose('replyAll') : undefined,
      forward: openMessage ? () => openCompose('forward') : undefined,
      next: () => step(1),
      previous: () => step(-1),
      open: visibleMessages.length > 0 && !openMessage ? () => step(0) : undefined,
      archive: openMessage && !inTrash ? () => void archive([openMessage.id]) : undefined,
      trash: openMessage && !inTrash ? () => void trash([openMessage.id]) : undefined,
      toggleStar: openMessage ? () => void toggleStar(openMessage.id) : undefined,
      markUnread: openMessage ? () => void setRead([openMessage.id], false) : undefined,
      refresh: refreshAll,
      search: () => {
        const box = document.querySelector<HTMLInputElement>('input[type="search"]');
        box?.focus();
      },
      close: () => {
        if (compose.open) return;
        if (openMessage) setOpenMessage(null);
      },
    },
    // Off while compose owns the keyboard. Settings is its own route,
    // so it cannot be over this view any more.
    !compose.open,
  );

  const openCompose = (mode: ComposeMode) => {
    if (!openMessage && mode !== 'compose') return;
    setCompose({ open: true, mode, replyTo: openMessage ?? undefined });
  };

  // Nothing of the mailbox renders until the session is confirmed. Painting it
  // first meant a signed-out visitor saw the whole interface, then "not logged
  // in", then a redirect -- which reads as though someone else's mail had
  // loaded and then been snatched away.
  if (!sessionChecked) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-gray-900">
        <p className="text-sm text-gray-500">Loading your mailbox…</p>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-900">
      {/* Full width, above the sidebar rather than beside it, so the product
          identity and the search box stay put no matter which folder or
          message is open -- the thing that makes Gmail always read as Gmail.
          It used to live inside the message column, which left the top-left
          corner of the app unbranded. */}
      <WebmailHeader
        email={displayEmail || 'Webmail'}
        unreadCount={unreadCount}
        onToggleSidebar={() => setShowSidebar((prev) => !prev)}
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={runSearch}
        searchPlaceholder="Search all mail…"
        onRefresh={refreshAll}
        refreshing={loadingList}
        onLogout={logout}
        onOpenSettings={() => router.push('/webmail/settings')}
      />

      <div className="flex-1 flex overflow-hidden">
        {showSidebar && (
          <div className={isMobileView ? 'absolute z-20 h-full bg-white dark:bg-gray-800 shadow-lg' : ''}>
            <WebmailSidebar
              folders={folders}
              activeFolder={activeFolder}
              onFolderChange={handleFolderChange}
              onCompose={() => setCompose({ open: true, mode: 'compose' })}
              onCreateFolder={createFolder}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          {error && (
            <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-400 flex items-center justify-between gap-3">
              <span>{error}</span>
              <button onClick={refreshAll} className="underline underline-offset-2 flex-shrink-0">
                Try again
              </button>
            </div>
          )}

          {notice && (
            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-300 flex items-center justify-between gap-3">
              <span>{notice}</span>
              <button
                onClick={() => setNotice(null)}
                className="underline underline-offset-2 flex-shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeSearch && (
            <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-800 dark:text-blue-300 flex items-center justify-between gap-3">
              <span>
                {total} result{total === 1 ? '' : 's'} for &ldquo;{activeSearch}&rdquo; across all
                folders
              </span>
              <button
                onClick={() => {
                  setSearch('');
                  runSearch('');
                }}
                className="underline underline-offset-2 flex-shrink-0"
              >
                Clear search
              </button>
            </div>
          )}

          <div className="flex-1 flex flex-col overflow-hidden">
            {!openMessage && !loadingMessage && (
              <>
                <WebmailToolbar
                  selectedCount={selectedIds.length}
                  allSelected={allSelected}
                  onSelectAll={(selected) =>
                    setSelectedIds(selected ? visibleMessages.map((m) => m.id) : [])
                  }
                  onRefresh={refreshAll}
                  refreshing={loadingList}
                  rangeLabel={
                    total === 0 ? 'No messages' : `${rangeStart}–${rangeEnd} of ${total}`
                  }
                  syncedLabel={lastSyncAt ? `Synced ${formatRelativeSync(lastSyncAt)}` : undefined}
                  onPrevPage={hasPrev ? () => goToPage(Math.max(0, offset - PAGE_SIZE)) : undefined}
                  onNextPage={hasNext ? () => goToPage(offset + PAGE_SIZE) : undefined}
                  onArchiveSelected={inTrash ? undefined : () => void archive(selectedIds)}
                  onTrashSelected={inTrash ? undefined : () => void trash(selectedIds)}
                  onDeleteForeverSelected={
                    inTrash ? () => void deleteForever(selectedIds) : undefined
                  }
                  onMarkReadSelected={() => void setRead(selectedIds, true)}
                  onMarkUnreadSelected={() => void setRead(selectedIds, false)}
                  onMoveSelected={() => setShowBulkMove(true)}
                  onSpamSelected={
                    activeFolderMeta?.role === 'junk' ? undefined : () => void markSpam(selectedIds)
                  }
                />

                <div className="flex-1 overflow-y-auto">
                  <WebmailList
                    density={settings?.displayDensity ?? 'comfortable'}
                    emails={visibleMessages}
                    selectedIds={selectedIds}
                    onSelectEmail={(id, selected) =>
                      setSelectedIds((prev) =>
                        selected ? [...prev, id] : prev.filter((sid) => sid !== id),
                      )
                    }
                    onEmailClick={handleOpen}
                    loading={loadingList}
                    onStarEmail={(id) => void toggleStar(id)}
                    onArchiveEmail={(id) => void archive([id])}
                    onTrashEmail={(id) => {
                      if (!inTrash) {
                        void trash([id]);
                        return;
                      }
                      setPendingDeleteForever(messages.find((m) => m.id === id) ?? null);
                    }}
                    emptyState={
                      <WebmailEmptyState
                        folder={activeFolder}
                        role={activeFolderMeta?.role ?? null}
                        searchQuery={search.trim() || undefined}
                      />
                    }
                  />
                </div>
              </>
            )}

            {loadingMessage && (
              <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-primary" />
              </div>
            )}

            {openMessage && !loadingMessage && (
              <WebmailMessageView
                message={openMessage}
                thread={thread}
                folders={folders}
                attachmentHref={attachmentUrl}
                onOpenMessage={(item) => void handleOpen(item)}
                onClose={() => setOpenMessage(null)}
                onArchive={() => void archive([openMessage.id])}
                onTrash={() => void trash([openMessage.id])}
                onDeleteForever={
                  inTrash ? () => void deleteForever([openMessage.id]) : undefined
                }
                onStar={() => void toggleStar(openMessage.id)}
                onMove={(folder) => void move([openMessage.id], folder)}
                onReply={() => openCompose('reply')}
                onReplyAll={() => openCompose('replyAll')}
                onForward={() => openCompose('forward')}
                onComposeWithBody={(body) =>
                  setCompose({ open: true, mode: 'compose', initialBody: body })
                }
                onAiWrite={aiWrite}
                onSummarize={summarize}
              />
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!pendingDeleteForever}
        onClose={() => setPendingDeleteForever(null)}
        onConfirm={() => {
          if (pendingDeleteForever) void deleteForever([pendingDeleteForever.id]);
        }}
        icon={<Trash2 size={20} />}
        tone="danger"
        title="Delete forever"
        body={
          <>
            <span className="font-medium">&ldquo;{pendingDeleteForever?.subject}&rdquo;</span> will
            be erased from the mail server. This cannot be undone.
          </>
        }
        confirmLabel="Delete forever"
        typedConfirmation="DELETE"
      />

      <MoveEmailModal
        isOpen={showBulkMove}
        onClose={() => setShowBulkMove(false)}
        onMove={(folder) => void move(selectedIds, folder)}
        label={`${selectedIds.length} message${selectedIds.length === 1 ? '' : 's'}`}
        currentFolder={activeFolder}
        folders={folders}
      />

      {helpOpen && <WebmailShortcutHelp onClose={() => setHelpOpen(false)} />}

      {pendingSend && (
        <WebmailUndoToast
          subject={pendingSend.subject}
          until={pendingSend.until}
          onUndo={cancelUndo}
        />
      )}

      {compose.open && (
        <WebmailCompose
          mode={compose.mode}
          replyTo={compose.replyTo}
          selfAddress={displayEmail}
          initialValues={
            compose.resumed
              ? { ...compose.resumed, body: compose.initialBody ?? '' }
              : compose.initialBody
                ? { body: compose.initialBody }
                : undefined
          }
          onClose={() => setCompose({ open: false, mode: 'compose' })}
          onSent={() => {
            setCompose({ open: false, mode: 'compose' });
            void loadMessages(activeFolder, { silent: true, offset, search: activeSearch });
          }}
          onSend={send}
          onAiWrite={aiWrite}
          onSaveDraft={saveDraft}
          onDiscardDraft={discardDraft}
          existingDraftId={compose.draftId}
          contacts={contacts}
        />
      )}
    </div>
  );
}
