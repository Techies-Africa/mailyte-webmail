'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import Sidebar from '@/components/webmail/shell/Sidebar';
import FolderNav from '@/components/webmail/shell/FolderNav';
import { useSidebarCollapsed } from '@/components/webmail/shell/useSidebarCollapsed';
import MessageListPane from '@/components/webmail/shell/MessageListPane';
import ReadingPane, { type QuickReplyMode } from '@/components/webmail/shell/ReadingPane';
import CalendarPanel from '@/components/webmail/shell/CalendarPanel';
import ContactsPanel from '@/components/webmail/shell/ContactsPanel';
import ComposeDock from '@/components/webmail/compose/ComposeDock';
import WebmailSkeleton from '@/components/webmail/WebmailSkeleton';
import WebmailShortcutHelp from '@/components/webmail/WebmailShortcutHelp';
import ConfirmModal from '@/components/webmail/modals/ConfirmModal';
import MoveEmailModal from '@/components/webmail/modals/MoveEmailModal';
import LabelPickerDialog from '@/components/webmail/modals/LabelPickerDialog';
import type { ComposeMode, WebmailListItem } from '@/components/webmail/types';
import type { ComposePayload } from '@/components/webmail/compose/types';
import { useMailbox, type SendContext } from '@/lib/webmail/useMailbox';
import { useOutbox } from '@/components/providers/OutboxProvider';
import { useComposeWindows } from '@/lib/webmail/useComposeWindows';
import { useKeyboardShortcuts, useUnreadTitle } from '@/lib/webmail/useKeyboardShortcuts';

/**
 * The mailbox screen: the rail, the message list, the reading pane, and the
 * compose dock over the top. State lives in useMailbox and useComposeWindows;
 * this file is the wiring between them and the panes.
 */
export default function WebmailInboxPage() {
  const router = useRouter();
  const mailbox = useMailbox();
  const compose = useComposeWindows();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();

  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<'calendar' | 'contacts' | null>(null);
  const [quickReply, setQuickReply] = useState<QuickReplyMode>(null);
  const [showBulkMove, setShowBulkMove] = useState(false);
  const [showBulkLabel, setShowBulkLabel] = useState(false);
  const [pendingDeleteForever, setPendingDeleteForever] = useState<{ ids: string[]; label: string } | null>(null);

  const {
    sessionChecked,
    displayEmail,
    settings,
    folders,
    activeFolder,
    openMessage,
    messages,
    selectedIds,
    unreadCount,
    inTrash,
    signatureSeed,
    sharedMailboxes,
  } = mailbox;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // A different message means a fresh reply box.
  useEffect(() => {
    setQuickReply(null);
  }, [openMessage?.id]);

  // --- Compose entry points ------------------------------------------------------

  const openNewMessage = useCallback(
    (to?: string, body?: string) => {
      compose.openCompose({
        mode: 'compose',
        initialBody: (body ?? '') + signatureSeed('compose'),
        resumed: to ? { to, cc: '', bcc: '', subject: '' } : undefined,
      });
    },
    [compose, signatureSeed],
  );

  /**
   * `/?compose=<address>` opens a new message to that person (the address
   * book's write button); `/?compose=new` opens an empty one (the Compose
   * button on the settings and calendar screens).
   */
  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get('compose');
    if (!to) return;
    openNewMessage(to === 'new' ? undefined : to);
    window.history.replaceState({}, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpen = useCallback(
    async (item: WebmailListItem) => {
      const result = await mailbox.open(item);
      if (result.kind === 'draft') {
        // Opening a draft resumes writing it: there is nothing to read (F6).
        const message = result.message;
        compose.openCompose({
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
      }
      if (isMobile) setMenuOpen(false);
    },
    [mailbox, compose, isMobile],
  );

  const openReplyInComposer = useCallback(
    (mode: ComposeMode, body?: string) => {
      if (!openMessage) return;
      compose.openCompose({
        mode,
        replyTo: openMessage,
        initialBody: body ?? signatureSeed(mode) ?? undefined,
      });
      setQuickReply(null);
    },
    [openMessage, compose, signatureSeed],
  );

  const send = useCallback(
    (payload: ComposePayload, context: SendContext) => mailbox.send(payload, context),
    [mailbox],
  );

  // Undo, or Reopen after a failed send -- from this page or any other --
  // puts the message back in a compose window exactly as it was: its text
  // (quote included, so it is not quoted twice), attachments and From, and
  // marked as edited, so closing it saves what is there.
  const { openCompose } = compose;
  const { registerComposeOpener } = useOutbox();
  useEffect(
    () =>
      registerComposeOpener(({ payload, context }) =>
        openCompose({
          mode: context.mode,
          replyTo: context.replyTo,
          initialBody: payload.body,
          draftId: payload.draftId ?? context.draftId,
          resumed: { to: payload.to, cc: payload.cc, bcc: payload.bcc, subject: payload.subject },
          attachments: payload.attachments,
          from: payload.from,
          quoteIncluded: true,
          restored: true,
        }),
      ),
    [registerComposeOpener, openCompose],
  );

  // Leaving the inbox keeps what is being written -- it is saved to Drafts --
  // but not its attachments. Ask first, only when there are some.
  const { hasAttachments } = compose;
  const confirmLeave = useCallback(
    () =>
      !hasAttachments() ||
      window.confirm('Leave the inbox? The message you are writing is saved to Drafts, but its attachments are not kept.'),
    [hasAttachments],
  );

  const fromOptions = useMemo(
    () =>
      sharedMailboxes
        .filter((m) => m.can_send)
        .map((m) => ({ address: m.address, name: m.name || null })),
    [sharedMailboxes],
  );

  // --- Trash rules -----------------------------------------------------------------

  const trashRow = useCallback(
    (item: WebmailListItem) => {
      if (!inTrash) {
        void mailbox.trash([item.id]);
        return;
      }
      setPendingDeleteForever({ ids: [item.id], label: item.subject });
    },
    [inTrash, mailbox],
  );

  // --- Keyboard ------------------------------------------------------------------------

  useUnreadTitle(unreadCount);

  const selectedIndex = openMessage ? messages.findIndex((m) => m.id === openMessage.id) : -1;
  const step = useCallback(
    (delta: number) => {
      if (messages.length === 0) return;
      const next = selectedIndex === -1 ? 0 : selectedIndex + delta;
      const target = messages[Math.max(0, Math.min(messages.length - 1, next))];
      if (target) void handleOpen(target);
    },
    [messages, selectedIndex, handleOpen],
  );

  const [searchSignal, setSearchSignal] = useState(0);
  const anyComposeOpen = compose.windows.some((w) => w.layout !== 'minimized');

  const { helpOpen, setHelpOpen } = useKeyboardShortcuts(
    {
      compose: () => openNewMessage(),
      reply: openMessage ? () => setQuickReply('reply') : undefined,
      replyAll: openMessage ? () => setQuickReply('replyAll') : undefined,
      forward: openMessage ? () => openReplyInComposer('forward') : undefined,
      next: () => step(1),
      previous: () => step(-1),
      open: messages.length > 0 && !openMessage ? () => step(0) : undefined,
      archive: openMessage && !inTrash ? () => void mailbox.archive([openMessage.id]) : undefined,
      trash: openMessage && !inTrash ? () => void mailbox.trash([openMessage.id]) : undefined,
      toggleStar: openMessage ? () => void mailbox.toggleStar(openMessage.id) : undefined,
      markUnread: openMessage
        ? () => {
            void mailbox.setRead([openMessage.id], false);
            mailbox.close();
          }
        : undefined,
      refresh: mailbox.refreshAll,
      search: () => setSearchSignal((n) => n + 1),
      close: () => {
        if (panel) {
          setPanel(null);
          return;
        }
        if (quickReply) {
          setQuickReply(null);
          return;
        }
        if (openMessage) mailbox.close();
      },
    },
    !anyComposeOpen,
  );

  if (!sessionChecked) {
    return <WebmailSkeleton />;
  }

  const showList = !isMobile || !openMessage;

  return (
    <div className="relative flex h-screen overflow-hidden bg-pane">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onCompose={() => {
          openNewMessage();
          setMenuOpen(false);
        }}
        email={displayEmail}
        name={settings?.name ?? null}
        unreadCount={unreadCount}
        onOpenSettings={() => confirmLeave() && router.push('/settings')}
        onOpenSecurity={() => confirmLeave() && router.push('/settings/security')}
        onShowShortcuts={() => setHelpOpen(true)}
        onHome={() => {
          mailbox.setFolder('INBOX');
          setMenuOpen(false);
        }}
        onLeave={confirmLeave}
        mobileOpen={menuOpen}
        onCloseMobile={() => setMenuOpen(false)}
      >
        <FolderNav
          folders={folders}
          activeFolder={activeFolder}
          collapsed={collapsed && !menuOpen}
          onFolderChange={(folder) => {
            mailbox.setFolder(folder);
            setMenuOpen(false);
          }}
          onCreateFolder={mailbox.createFolder}
          onRenameFolder={mailbox.renameFolder}
          onDeleteFolder={mailbox.deleteFolder}
          labels={mailbox.labels}
          calendar={
            mailbox.calendarAvailable
              ? { active: panel === 'calendar', onToggle: () => setPanel((p) => (p === 'calendar' ? null : 'calendar')) }
              : undefined
          }
          contacts={
            mailbox.contactsAvailable
              ? { active: panel === 'contacts', onToggle: () => setPanel((p) => (p === 'contacts' ? null : 'contacts')) }
              : undefined
          }
        />
      </Sidebar>

      <div className="relative flex min-w-0 flex-1">
        {showList && (
          <MessageListPane
            mailbox={mailbox}
            fullWidth={isMobile}
            onOpen={(item) => void handleOpen(item)}
            onTrashRow={trashRow}
            onBulkMove={() => setShowBulkMove(true)}
            onBulkLabel={() => setShowBulkLabel(true)}
            onBulkDeleteForever={() =>
              setPendingDeleteForever({
                ids: selectedIds,
                label: `${selectedIds.length} message${selectedIds.length === 1 ? '' : 's'}`,
              })
            }
            onOpenMenu={() => setMenuOpen(true)}
            searchSignal={searchSignal}
          />
        )}

        <ReadingPane
          mailbox={mailbox}
          isMobile={isMobile}
          quickReply={quickReply}
          onQuickReplyChange={setQuickReply}
          onForward={() => openReplyInComposer('forward')}
          onOpenInComposer={(mode, body) => openReplyInComposer(mode, body)}
          onQuickReplySend={(payload, mode) =>
            send(payload, { mode, replyTo: openMessage ?? undefined })
          }
          onComposeWithBody={(body) => openNewMessage(undefined, body)}
          onDeleteForever={() => {
            if (openMessage) setPendingDeleteForever({ ids: [openMessage.id], label: openMessage.subject });
          }}
        />
      </div>

      {mailbox.calendarAvailable && (
        <CalendarPanel
          open={panel === 'calendar'}
          onClose={() => setPanel(null)}
          onUnauthorized={mailbox.handleUnauthorized}
          onLeave={confirmLeave}
        />
      )}
      {mailbox.contactsAvailable && (
        <ContactsPanel
          open={panel === 'contacts'}
          onClose={() => setPanel(null)}
          onLeave={confirmLeave}
          contacts={mailbox.contacts}
          onWriteTo={(email, name) => {
            setPanel(null);
            openNewMessage(name ? `${name} <${email}>` : email);
          }}
        />
      )}

      <ComposeDock
        compose={compose}
        isMobile={isMobile}
        selfAddress={displayEmail}
        selfName={settings?.name ?? null}
        fromOptions={fromOptions}
        contacts={mailbox.contacts}
        canSchedule={mailbox.scheduleAvailable}
        onAiWrite={mailbox.aiAvailable ? mailbox.aiWrite : undefined}
        onSend={send}
        onSaveDraft={mailbox.saveDraft}
        onDiscardDraft={mailbox.discardDraft}
      />

      <ConfirmModal
        isOpen={!!pendingDeleteForever}
        onClose={() => setPendingDeleteForever(null)}
        onConfirm={() => {
          if (pendingDeleteForever) void mailbox.deleteForever(pendingDeleteForever.ids);
        }}
        icon={<Trash2 size={18} />}
        tone="danger"
        title="Delete forever"
        body={
          <>
            <span className="font-semibold text-foreground">&ldquo;{pendingDeleteForever?.label}&rdquo;</span> will be
            erased from the mail server. This cannot be undone.
          </>
        }
        confirmLabel="Delete forever"
        typedConfirmation="DELETE"
      />

      <MoveEmailModal
        isOpen={showBulkMove}
        onClose={() => setShowBulkMove(false)}
        onMove={(folder) => void mailbox.move(selectedIds, folder)}
        label={`${selectedIds.length} message${selectedIds.length === 1 ? '' : 's'}`}
        currentFolder={activeFolder}
        folders={folders}
      />

      <LabelPickerDialog
        isOpen={showBulkLabel}
        onClose={() => setShowBulkLabel(false)}
        known={mailbox.labels}
        current={messages.filter((m) => selectedIds.includes(m.id)).map((m) => m.labels)}
        what={`${selectedIds.length} message${selectedIds.length === 1 ? '' : 's'}`}
        onApply={(add, remove) => void mailbox.applyLabels(selectedIds, add, remove)}
      />

      {helpOpen && <WebmailShortcutHelp onClose={() => setHelpOpen(false)} />}

    </div>
  );
}
