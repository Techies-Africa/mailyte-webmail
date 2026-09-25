'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Ban,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Download,
  FileCode2,
  FileDown,
  FolderInput,
  Forward,
  Hash,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  Reply,
  ReplyAll,
  ShieldCheck,
  AlertOctagon,
  Sparkles,
  Star,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react';
import type { ComposeMode, SendResult, WebmailAttachment, WebmailListItem, WebmailMessage } from '../types';
import type { ComposePayload } from '../compose/types';
import type { Mailbox } from '@/lib/webmail/useMailbox';
import { attachmentPreviewUrl, attachmentUrl, isPreviewableAttachment, originalPageUrl, rawMessageUrl } from '@/lib/webmail/client';
import { allowImageSender, isImageSenderAllowed, remoteImagePolicy } from '@/lib/webmail/sanitize';
import { formatDateTime, formatShortDateTime } from '@/lib/webmail/dates';
import WebmailBodyFrame, { BlockedImagesBar } from '../WebmailBodyFrame';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Menu from '@/components/ui/Menu';
import MoveEmailModal from '../modals/MoveEmailModal';
import AiWriterModal from '../modals/AiWriterModal';
import ThreadSummaryModal from '../modals/ThreadSummaryModal';
import ConfirmModal from '../modals/ConfirmModal';
import LabelPickerDialog from '../modals/LabelPickerDialog';
import QuickReply from './QuickReply';
import { Tag } from '@/components/ui/Pill';
import { labelTag } from '@/lib/webmail/tags';

export type QuickReplyMode = 'reply' | 'replyAll' | null;

type ReadingPaneProps = {
  mailbox: Mailbox;
  isMobile: boolean;
  quickReply: QuickReplyMode;
  onQuickReplyChange: (mode: QuickReplyMode) => void;
  onForward: () => void;
  /** Move an inline reply into a full compose window with what was typed. */
  onOpenInComposer: (mode: 'reply' | 'replyAll', body: string) => void;
  onQuickReplySend: (payload: ComposePayload, mode: ComposeMode) => Promise<SendResult>;
  /** The AI writer's "Use this": a new message starting with that body. */
  onComposeWithBody: (body: string) => void;
  onDeleteForever: () => void;
  /**
   * Bumped on every Reply / Reply all request -- including a repeat of the
   * mode already open, which changes nothing else and so would otherwise do
   * nothing. The reply box brings itself back into view on it.
   */
  replySignal?: number;
};

/**
 * Newest first, with undated messages last. A message whose header carried
 * no date must NOT be presented as the most recent thing in a conversation.
 */
export function byNewestFirst(a: WebmailListItem, b: WebmailListItem): number {
  if (!a.receivedAt && !b.receivedAt) return 0;
  if (!a.receivedAt) return 1;
  if (!b.receivedAt) return -1;
  return b.receivedAt.getTime() - a.receivedAt.getTime();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * An attachment chip.
 *
 * Clicking the name opens a PREVIEW in a new tab when the browser can show
 * the type itself (images, PDF, text, audio, video); the browser's own viewer
 * then has its download button. The small arrow at the end always downloads
 * straight away. Types the browser would have to execute or that need another
 * app -- HTML, Office files, archives -- download on click, because a
 * sender-supplied document rendered on this origin is stored XSS (PRD SS7.6).
 */
function AttachmentChip({
  attachment,
  href,
  previewHref,
}: {
  attachment: WebmailAttachment;
  href: string;
  previewHref: string;
}) {
  const previewable = isPreviewableAttachment(attachment.type);
  return (
    <span className="inline-flex max-w-xs items-stretch overflow-hidden rounded-lg border border-border bg-card text-[12.5px]">
      <a
        href={previewable ? previewHref : href}
        target={previewable ? '_blank' : undefined}
        rel={previewable ? 'noopener' : undefined}
        download={previewable ? undefined : attachment.name}
        title={previewable ? `Open ${attachment.name} in a new tab` : `Download ${attachment.name}`}
        className="flex min-w-0 items-center gap-2 px-3 py-2 hover:bg-muted"
      >
        <Paperclip size={14} className="shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{attachment.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>
      </a>
      <a
        href={href}
        download={attachment.name}
        title={`Download ${attachment.name}`}
        aria-label={`Download ${attachment.name}`}
        className="flex shrink-0 items-center border-l border-border px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Download size={13} />
      </a>
    </span>
  );
}

type ThreadState = {
  expanded: string[];
  bodies: Record<string, WebmailMessage>;
  errors: Record<string, string>;
  loadingId: string | null;
};

const EMPTY_THREAD_STATE: ThreadState = { expanded: [], bodies: {}, errors: {}, loadingId: null };

function participantsLine(list: { name: string | null; email: string }[]): string {
  return list.map((p) => p.name || p.email).join(', ');
}

export default function ReadingPane({
  mailbox,
  isMobile,
  quickReply,
  onQuickReplyChange,
  onForward,
  onOpenInComposer,
  onQuickReplySend,
  onComposeWithBody,
  onDeleteForever,
  replySignal,
}: ReadingPaneProps) {
  const { openMessage: message, loadingMessage } = mailbox;

  if (loadingMessage && !message) {
    return (
      // Over the list on a phone, where the list fills the width: in the row
      // beside it this spinner had no width at all, and a tapped message
      // looked like nothing had happened until it arrived.
      <section
        aria-label="Message"
        aria-busy="true"
        className={`flex min-w-0 flex-1 flex-col bg-pane ${isMobile ? 'absolute inset-0 z-20' : ''}`}
      >
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </section>
    );
  }

  if (!message) {
    return (
      <section className="hidden min-w-0 flex-1 flex-col bg-pane md:flex">
        <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
          <div className="mb-3.5 flex h-16 w-16 items-center justify-center rounded-[18px] border border-border bg-card shadow-sm">
            <Mail size={26} strokeWidth={1.6} className="text-primary" />
          </div>
          <div className="font-display text-[13.5px] font-semibold text-foreground">Select a message</div>
          <div className="mt-1 text-[12.5px]">Click any email to read it here</div>
        </div>
      </section>
    );
  }

  return (
    <MessageReader
      key={message.id}
      message={message}
      mailbox={mailbox}
      isMobile={isMobile}
      quickReply={quickReply}
      onQuickReplyChange={onQuickReplyChange}
      onForward={onForward}
      onOpenInComposer={onOpenInComposer}
      onQuickReplySend={onQuickReplySend}
      onComposeWithBody={onComposeWithBody}
      onDeleteForever={onDeleteForever}
      replySignal={replySignal}
    />
  );
}

/**
 * Keyed on the message id by the parent, so reading a different message
 * REMOUNTS this: thread rows, blocked-image counts and open dialogs all
 * describe the message being read, and a fresh component is the reset.
 */
function MessageReader({
  message,
  mailbox,
  isMobile,
  quickReply,
  onQuickReplyChange,
  onForward,
  onOpenInComposer,
  onQuickReplySend,
  onComposeWithBody,
  onDeleteForever,
  replySignal,
}: ReadingPaneProps & { message: WebmailMessage }) {
  const {
    thread,
    folders,
    inTrash,
    inJunk,
    close,
    archive,
    trash,
    toggleStar,
    move,
    setRead,
    markSpam,
    markNotSpam,
    blockSender,
    sendTimes,
    cancelScheduledSend,
    loadThreadMessage,
    aiAvailable,
    aiWrite,
    summarize,
    displayEmail,
    signatureSeed,
    open: openItem,
    labels,
    applyLabels,
  } = mailbox;

  const [showMove, setShowMove] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showAiWriter, setShowAiWriter] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blockedImages, setBlockedImages] = useState(0);
  const [showImagesOnce, setShowImagesOnce] = useState(false);
  const [threadState, setThreadState] = useState<ThreadState>(EMPTY_THREAD_STATE);

  const scheduled = sendTimes[message.id];
  const earlier = useMemo(
    () => thread.filter((m) => m.id !== message.id).sort(byNewestFirst),
    [thread, message.id],
  );

  // Whether remote images load on open. The policy is the reader's own
  // (Settings › General); under `ask` the per-sender allowance and the
  // "show once" button still apply. Read per message rather than once, so
  // changing the setting takes effect on the next message opened.
  const policy = useMemo(() => remoteImagePolicy(), [message.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const senderAllowed = useMemo(() => isImageSenderAllowed(message.fromEmail), [message.fromEmail]);
  const allowRemoteImages = policy === 'always' || senderAllowed || showImagesOnce;
  const handleBlockedCount = useCallback((count: number) => setBlockedImages(count), []);

  // Escape closes the inline reply before it closes the message -- but not
  // when it has just closed a menu or the link box above the reply. On
  // window, so those (on document) have had the key first. ProseMirror marks
  // every Escape typed in an editor as handled without acting on it, so one
  // from the reply's own editor (an editor not inside a compose window or
  // dialog) still closes the reply, as it always has.
  useEffect(() => {
    if (!quickReply) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const fromReplyEditor = !!target?.isContentEditable && !target.closest('[role="dialog"]');
      if (event.defaultPrevented && !fromReplyEditor) return;
      event.preventDefault();
      onQuickReplyChange(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quickReply, onQuickReplyChange]);

  const toggleEarlier = useCallback(
    async (item: WebmailListItem) => {
      if (threadState.expanded.includes(item.id)) {
        setThreadState((prev) => ({ ...prev, expanded: prev.expanded.filter((id) => id !== item.id) }));
        return;
      }
      const alreadyLoaded = Boolean(threadState.bodies[item.id]);
      setThreadState((prev) => {
        const errors = { ...prev.errors };
        delete errors[item.id];
        return {
          ...prev,
          expanded: [...prev.expanded, item.id],
          errors,
          loadingId: alreadyLoaded ? prev.loadingId : item.id,
        };
      });
      if (alreadyLoaded) return;
      const loaded = await loadThreadMessage(item.id);
      setThreadState((prev) => {
        const loadingId = prev.loadingId === item.id ? null : prev.loadingId;
        if (!loaded) {
          return {
            ...prev,
            loadingId,
            errors: { ...prev.errors, [item.id]: 'This message could not be loaded. It may have been moved or deleted.' },
          };
        }
        return { ...prev, loadingId, bodies: { ...prev.bodies, [item.id]: loaded } };
      });
    },
    [threadState, loadThreadMessage],
  );

  const isOwnAddress = message.fromEmail.toLowerCase() === displayEmail.toLowerCase();

  const downloadOriginal = () => {
    const anchor = document.createElement('a');
    anchor.href = rawMessageUrl(message.id);
    anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const moreItems = [
    // A phone's header has room for Reply alone; the other two live here.
    ...(isMobile
      ? [
          { key: 'replyAll', label: 'Reply all', icon: <ReplyAll size={14} />, onSelect: () => onQuickReplyChange('replyAll') },
          { key: 'forward', label: 'Forward', icon: <Forward size={14} />, onSelect: onForward },
        ]
      : []),
    { key: 'labels', label: 'Label…', icon: <TagIcon size={14} />, onSelect: () => setShowLabels(true) },
    { key: 'move', label: 'Move to folder…', icon: <FolderInput size={14} />, onSelect: () => setShowMove(true) },
    {
      key: 'unread',
      label: 'Mark as unread',
      icon: <Mail size={14} />,
      onSelect: () => {
        void setRead([message.id], false);
        close();
      },
    },
    // Also here at every width, like Mark as unread: the toolbar's own spam
    // button is hidden on a phone, where it was otherwise unreachable.
    ...(!inJunk
      ? [{ key: 'spam', label: 'Mark as spam', icon: <AlertOctagon size={14} />, onSelect: () => void markSpam([message.id]) }]
      : []),
    ...(aiAvailable
      ? [
          { key: 'summary', label: 'Summarize conversation', icon: <Hash size={14} />, onSelect: () => setShowSummary(true) },
          { key: 'ai', label: 'Write with AI', icon: <Sparkles size={14} />, onSelect: () => setShowAiWriter(true) },
        ]
      : []),
    {
      key: 'original',
      label: 'Show original',
      icon: <FileCode2 size={14} />,
      onSelect: () => window.open(originalPageUrl(message.id), '_blank', 'noopener'),
    },
    { key: 'raw', label: 'Download original (.eml)', icon: <FileDown size={14} />, onSelect: downloadOriginal },
    ...(!isOwnAddress && message.fromEmail
      ? [{ key: 'block', label: `Block ${message.fromEmail}`, icon: <Ban size={14} />, tone: 'danger' as const, onSelect: () => setConfirmBlock(true) }]
      : []),
  ];

  const replyButtons = (variant: 'header' | 'dashed') => (
    <>
      <Button
        variant={variant === 'header' ? 'primary' : 'dashed'}
        size={variant === 'header' ? 'sm' : 'md'}
        icon={<Reply size={12} strokeWidth={2.4} />}
        onClick={() => onQuickReplyChange('reply')}
        className={variant === 'dashed' ? 'flex-1' : ''}
      >
        Reply
      </Button>
      <Button
        variant={variant === 'header' ? 'secondary' : 'dashed'}
        size={variant === 'header' ? 'sm' : 'md'}
        icon={<ReplyAll size={12} strokeWidth={2.2} />}
        onClick={() => onQuickReplyChange('replyAll')}
        className={variant === 'dashed' ? 'flex-1' : 'hidden sm:inline-flex'}
      >
        Reply all
      </Button>
      <Button
        variant={variant === 'header' ? 'secondary' : 'dashed'}
        size={variant === 'header' ? 'sm' : 'md'}
        icon={<Forward size={12} strokeWidth={2.2} />}
        onClick={onForward}
        className={variant === 'dashed' ? 'flex-1' : 'hidden sm:inline-flex'}
      >
        Forward
      </Button>
    </>
  );

  // Touch-sized on a phone.
  const tool = isMobile ? 'lg' : 'md';

  return (
    <section
      aria-label="Message"
      className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-pane ${isMobile ? 'absolute inset-0 z-20' : ''}`}
    >
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card px-4 pb-3 pt-3.5 sm:px-6">
        {/* One DOM order everywhere -- Back, subject, tools -- so a screen
            reader hears the subject before the actions. On a phone the
            subject drops to its own row (order-last) and wraps: beside five
            buttons it had about 150px, some fifteen characters. */}
        <div className={isMobile ? 'mb-3 flex flex-wrap items-center gap-x-1 gap-y-2' : 'mb-3 flex items-center gap-2'}>
          {isMobile && (
            <IconButton label="Back to list" size="lg" onClick={close}>
              <ArrowLeft size={16} />
            </IconButton>
          )}
          <h1
            className={
              isMobile
                ? 'order-last line-clamp-3 w-full break-words font-display text-[17px] font-bold leading-snug tracking-tight'
                : 'min-w-0 flex-1 truncate font-display text-[17px] font-bold tracking-tight'
            }
            title={message.subject}
          >
            {message.subject}
          </h1>
          <div className={`flex shrink-0 items-center gap-1 ${isMobile ? 'ml-auto' : ''}`}>
            {isMobile ? (
              // Reply at the top on a phone too: it used to be only at the very
              // end of the message and the conversation below it.
              <IconButton label="Reply" size="lg" outlined tone="primary" onClick={() => onQuickReplyChange('reply')}>
                <Reply size={15} strokeWidth={2.4} />
              </IconButton>
            ) : (
              <>
                {replyButtons('header')}
                <span className="mx-0.5 h-[18px] w-px bg-border" />
              </>
            )}
            {!inTrash && (
              <IconButton label="Archive (e)" size={tool} outlined onClick={() => void archive([message.id])}>
                <Archive size={13} />
              </IconButton>
            )}
            <IconButton
              label="Mark unread (u)"
              size={tool}
              outlined
              onClick={() => {
                void setRead([message.id], false);
                close();
              }}
              className="hidden sm:inline-flex"
            >
              <MailOpen size={13} />
            </IconButton>
            <IconButton
              label={message.isStarred ? 'Unstar (s)' : 'Star (s)'}
              size={tool}
              outlined
              onClick={() => void toggleStar(message.id)}
              className={message.isStarred ? '!text-[hsl(38,85%,55%)]' : ''}
            >
              <Star size={13} className={message.isStarred ? 'fill-current' : ''} />
            </IconButton>
            {inJunk ? (
              <IconButton label="Not spam — move to Inbox" size={tool} outlined onClick={() => void markNotSpam([message.id])}>
                <ShieldCheck size={13} />
              </IconButton>
            ) : (
              <IconButton label="Mark as spam" size={tool} outlined onClick={() => void markSpam([message.id])} className="hidden sm:inline-flex">
                <AlertOctagon size={13} />
              </IconButton>
            )}
            {inTrash ? (
              <IconButton label="Delete forever" size={tool} outlined tone="danger" onClick={onDeleteForever}>
                <Trash2 size={13} />
              </IconButton>
            ) : (
              <IconButton label="Delete (#)" size={tool} outlined tone="danger" onClick={() => void trash([message.id])}>
                <Trash2 size={13} />
              </IconButton>
            )}
            <Menu
              label="More"
              align="right"
              items={moreItems}
              trigger={({ toggle, open }) => (
                <IconButton label="More" size={tool} outlined onClick={toggle} active={open}>
                  <MoreHorizontal size={13} />
                </IconButton>
              )}
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Avatar name={message.from} email={message.fromEmail} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold">
              {message.from}
              {message.from !== message.fromEmail && message.fromEmail && (
                <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">{message.fromEmail}</span>
              )}
            </div>
            <div className="truncate text-[11.5px] text-muted-foreground" title={participantsLine(message.to)}>
              to {message.to.length > 0 ? participantsLine(message.to) : displayEmail || 'me'}
              {message.cc.length > 0 && <span> · cc {participantsLine(message.cc)}</span>}
            </div>
          </div>
          <div className="shrink-0 text-[11.5px] text-muted-foreground" title={formatDateTime(message.timestamp)}>
            {formatShortDateTime(message.timestamp)}
          </div>
        </div>
        {message.labels.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {message.labels.map((slug) => {
              const tag = labelTag(slug);
              return (
                <Tag key={slug} tone={tag.tone}>
                  {tag.label}
                </Tag>
              );
            })}
            <button
              type="button"
              onClick={() => setShowLabels(true)}
              className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {/* scrollbar-gutter: a scrollbar appearing or going would change the
          message frame's width, and a wide email re-fits to every width. */}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable] sm:px-6 sm:py-5">
        <div className="mx-auto max-w-[760px]">
          {scheduled && (
            <div
              className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-2.5 text-[13px] ${
                scheduled.failed
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-primary/30 bg-primary/10 text-foreground'
              }`}
            >
              <CalendarClock size={15} className="shrink-0" />
              <span className="min-w-[12rem] flex-1">
                {scheduled.failed ? (
                  <>
                    <strong className="font-semibold">This message was not sent.</strong>
                    {scheduled.error ? ` ${scheduled.error}` : ''}
                  </>
                ) : (
                  <>
                    <strong className="font-semibold">Waiting to send.</strong> It goes out {scheduled.label}.
                  </>
                )}
              </span>
              <Button size="xs" onClick={() => void cancelScheduledSend(message.id)}>
                {scheduled.failed ? 'Move to drafts' : 'Cancel send'}
              </Button>
            </div>
          )}

          <BlockedImagesBar
            count={allowRemoteImages ? 0 : blockedImages}
            senderEmail={message.fromEmail}
            onShowOnce={() => setShowImagesOnce(true)}
            onAlwaysAllow={() => {
              allowImageSender(message.fromEmail);
              setShowImagesOnce(true);
            }}
          />

          {/* Edge to edge on a phone, as phone mail clients draw it: the
              card's padding and the pane's took about 60px of a 360px
              screen from the message. -mx-4 undoes the pane's px-4. */}
          <div className="-mx-4 border-y border-border bg-card px-2 py-3 sm:mx-0 sm:rounded-xl sm:border sm:p-5">
            <WebmailBodyFrame
              html={message.body}
              isHtml={message.bodyIsHtml}
              attachments={message.attachments}
              attachmentHref={(index) => attachmentUrl(message.id, index)}
              allowRemoteImages={allowRemoteImages}
              onBlockedCount={handleBlockedCount}
            />

            {message.attachments.filter((a) => !a.isInline).length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="mb-2 text-[12.5px] font-semibold text-muted-foreground">
                  {message.attachments.filter((a) => !a.isInline).length} attachment
                  {message.attachments.filter((a) => !a.isInline).length === 1 ? '' : 's'}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {message.attachments
                    .filter((a) => !a.isInline)
                    .map((attachment) => (
                      <AttachmentChip
                        key={attachment.index}
                        attachment={attachment}
                        href={attachmentUrl(message.id, attachment.index)}
                        previewHref={attachmentPreviewUrl(message.id, attachment.index)}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>

          {earlier.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Earlier in this conversation · {earlier.length}
              </h3>
              <div className="space-y-2">
                {earlier.map((m) => {
                  const expanded = threadState.expanded.includes(m.id);
                  const loaded = threadState.bodies[m.id];
                  const failed = threadState.errors[m.id];
                  return (
                    <div key={m.id} className="overflow-hidden rounded-xl border border-border bg-card">
                      <button
                        type="button"
                        onClick={() => void toggleEarlier(m)}
                        aria-expanded={expanded}
                        className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left hover:bg-muted/60"
                      >
                        {expanded ? (
                          <ChevronDown size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                        )}
                        <Avatar name={m.from} email={m.fromEmail} size={22} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{m.from}</span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(m.timestamp)}</span>
                          </span>
                          {!expanded && m.preview && (
                            <span className="mt-0.5 line-clamp-2 block text-[12px] text-muted-foreground">{m.preview}</span>
                          )}
                        </span>
                      </button>

                      {expanded && (
                        <div className="border-t border-border px-3.5 py-3">
                          {threadState.loadingId === m.id && <p className="text-sm text-muted-foreground">Loading…</p>}
                          {failed && (
                            <p className="text-sm text-destructive" role="alert">
                              {failed}
                            </p>
                          )}
                          {loaded && (
                            <>
                              {/* Same frame as the message above: identical sanitising and image blocking. */}
                              <WebmailBodyFrame
                                html={loaded.body}
                                isHtml={loaded.bodyIsHtml}
                                attachments={loaded.attachments}
                                attachmentHref={(index) => attachmentUrl(loaded.id, index)}
                                allowRemoteImages={allowRemoteImages}
                              />
                              {loaded.attachments.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {loaded.attachments.map((attachment) => (
                                    <AttachmentChip
                                      key={`${loaded.id}-${attachment.index}`}
                                      attachment={attachment}
                                      href={attachmentUrl(loaded.id, attachment.index)}
                                      previewHref={attachmentPreviewUrl(loaded.id, attachment.index)}
                                    />
                                  ))}
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => void openItem(m)}
                                className="mt-3 text-xs font-semibold text-primary hover:underline"
                              >
                                Open this message on its own
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-5">
            {quickReply ? (
              <QuickReply
                key={quickReply}
                message={message}
                mode={quickReply}
                selfAddress={displayEmail}
                signatureSeed={signatureSeed(quickReply)}
                onSend={onQuickReplySend}
                onCancel={() => onQuickReplyChange(null)}
                onExpand={(body) => onOpenInComposer(quickReply, body)}
                revealSignal={replySignal}
              />
            ) : (
              <div className="flex gap-2">{replyButtons('dashed')}</div>
            )}
          </div>
        </div>
      </div>

      <MoveEmailModal
        isOpen={showMove}
        onClose={() => setShowMove(false)}
        onMove={(folder) => void move([message.id], folder)}
        label={message.subject}
        currentFolder={message.folder}
        folders={folders}
      />

      <LabelPickerDialog
        isOpen={showLabels}
        onClose={() => setShowLabels(false)}
        known={labels}
        current={[message.labels]}
        what={message.subject}
        onApply={(add, remove) => void applyLabels([message.id], add, remove)}
      />

      {aiAvailable && (
        <AiWriterModal
          isOpen={showAiWriter}
          onClose={() => setShowAiWriter(false)}
          onGenerate={(prompt) => aiWrite(prompt, '')}
          onApply={onComposeWithBody}
        />
      )}

      {aiAvailable && (
        <ThreadSummaryModal
          isOpen={showSummary}
          onClose={() => setShowSummary(false)}
          thread={thread.length > 0 ? thread : [message]}
          onSummarize={(fresh) => summarize(message.id, fresh)}
        />
      )}

      <ConfirmModal
        isOpen={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        onConfirm={async () => {
          const ok = await blockSender(message.fromEmail);
          if (ok && !inJunk) void markSpam([message.id]);
        }}
        icon={<Ban size={18} />}
        tone="danger"
        title="Block this sender"
        body={
          <>
            New mail from <span className="font-mono font-semibold text-foreground">{message.fromEmail}</span> will be
            filed to Junk when it arrives, before any rule or forward runs. Nothing is deleted, and you can unblock
            them under Settings › Blocked senders. This message moves to Junk now.
          </>
        }
        confirmLabel="Block sender"
      />
    </section>
  );
}
