import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Star,
  Reply,
  ReplyAll,
  Forward,
  Archive,
  Trash2,
  X,
  FolderInput,
  Sparkles,
  Hash,
  Paperclip,
  Download,
  CalendarClock,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { WebmailAttachment, WebmailFolder, WebmailListItem, WebmailMessage } from './types';
import WebmailBodyFrame, { BlockedImagesBar } from './WebmailBodyFrame';
import { allowImageSender, isImageSenderAllowed } from '@/lib/webmail/sanitize';
import { formatDateTime, formatShortDateTime } from '@/lib/webmail/dates';
import ConfirmModal from './modals/ConfirmModal';
import MoveEmailModal from './modals/MoveEmailModal';
import AiWriterModal from './modals/AiWriterModal';
import ThreadSummaryModal from './modals/ThreadSummaryModal';
import Spinner from '@/components/Spinner';

type WebmailMessageViewProps = {
  message: WebmailMessage;
  /**
   * The rest of the conversation, oldest first, from the thread endpoint.
   * Summaries, not bodies: opening one loads it as the message in view
   * rather than fetching every body in the thread up front.
   */
  thread: WebmailListItem[];
  folders: WebmailFolder[];
  /** Where an attachment's bytes live -- see attachmentUrl() in lib/webmail/client. */
  attachmentHref: (messageId: string, index: number) => string;
  onOpenMessage: (item: WebmailListItem) => void;
  onClose: () => void;
  onArchive: () => void;
  onTrash: () => void;
  /** Only supplied when the message is already in Trash (PRD SS7.4). */
  onDeleteForever?: () => void;
  onStar: () => void;
  onMove: (folderName: string) => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onComposeWithBody: (body: string) => void;
  /**
   * Absent when the server reports no AI endpoint (GET
   * /mailbox/capabilities). The control is then not rendered at all rather
   * than rendered and failing -- a deployment with no AI configured used to
   * show this button and answer "Could not generate a draft. Please try
   * again.", which describes a temporary fault rather than a feature that was
   * never available.
   */
  onAiWrite?: (instruction: string, existingBody: string) => Promise<string>;
  /** Absent when the server reports no AI endpoint -- same rule as onAiWrite. */
  onSummarize?: () => Promise<string>;
  /**
   * Set when this message is waiting in the Scheduled folder.
   *
   * Opening one otherwise looked exactly like opening any other message: the
   * only date on screen was the header date, which is when it was WRITTEN.
   * Nothing said it had not been sent, and nothing said when it would be.
   */
  scheduled?: { label: string; failed: boolean; error: string | null };
  /** Cancel the scheduled send; the message goes back to Drafts. */
  onCancelScheduled?: () => void;
  /**
   * Move this message out of Junk. Set only when reading one that is IN Junk
   * -- the same rule as the list toolbar's counterpart, so the action appears
   * exactly where it makes sense and nowhere else.
   */
  onNotSpam?: () => void;
  /**
   * Fetch one earlier message in the thread, for expanding it in place.
   *
   * The thread endpoint returns summaries, not bodies, so the body arrives
   * only when someone actually asks for it. Passing the fetch in keeps this
   * component free of the API client, as every other action here already is.
   */
  onLoadThreadMessage?: (id: string) => Promise<WebmailMessage | null>;
};

/**
 * Everything the thread accordion holds.
 *
 * One object rather than four useStates because every part of it belongs to
 * ONE conversation and goes stale together.
 */
type ThreadState = {
  expanded: string[];
  bodies: Record<string, WebmailMessage>;
  errors: Record<string, string>;
  /** The one row currently fetching, if any. */
  loadingId: string | null;
};

const EMPTY_THREAD_STATE: ThreadState = {
  expanded: [],
  bodies: {},
  errors: {},
  loadingId: null,
};

/**
 * Newest first, with undated messages last.
 *
 * Exported so the rule can be tested and stated once rather than inlined in a
 * render. The null handling is the part worth having a name for: a message
 * whose header carried no date must NOT be presented as the most recent thing
 * in a conversation, which is what would happen if this sorted on `timestamp`
 * (that field falls back to now so every row has something to print). Same
 * rule the mobile client documents in message_detail_state.dart.
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
 * A downloadable attachment.
 *
 * `download` and the API's own Content-Disposition both say "save this" --
 * an attachment is never opened in the app's origin, whatever its type
 * claims to be (PRD SS7.6).
 */
function AttachmentChip({ attachment, href }: { attachment: WebmailAttachment; href: string }) {
  return (
    <a
      href={href}
      download={attachment.name}
      className="inline-flex items-center gap-2 max-w-xs px-3 py-2 border border-border rounded-lg hover:bg-muted"
    >
      <Paperclip size={15} className="text-gray-400 flex-shrink-0" />
      <span className="truncate text-sm text-gray-700 dark:text-gray-200">{attachment.name}</span>
      <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(attachment.size)}</span>
      <Download size={14} className="text-gray-400 flex-shrink-0" />
    </a>
  );
}

export default function WebmailMessageView({
  message,
  thread,
  folders,
  attachmentHref,
  onOpenMessage,
  onClose,
  onArchive,
  onTrash,
  onDeleteForever,
  onStar,
  onMove,
  onReply,
  onReplyAll,
  onForward,
  onComposeWithBody,
  onAiWrite,
  onSummarize,
  scheduled,
  onCancelScheduled,
  onNotSpam,
  onLoadThreadMessage,
}: WebmailMessageViewProps) {
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showDeleteForeverModal, setShowDeleteForeverModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showAiWriter, setShowAiWriter] = useState(false);
  const [showThreadSummary, setShowThreadSummary] = useState(false);
  const [blockedImages, setBlockedImages] = useState(0);
  const [showImagesOnce, setShowImagesOnce] = useState(false);

  /*
    Newest first, and sorted here rather than at the fetch.

    WHY NOT THE SERVER. The thread endpoint is documented as oldest-first and
    that is published in the API reference, so the order is a contract rather
    than an internal detail. It is also the right order for the OTHER readers
    of the same data: mobile merges the open message into one list, this view
    keeps it at the top with a backlog beneath, and no single server order
    serves both. Nothing depends on the server sorting it newest-first --
    mobile already re-sorts client-side -- so the sort belongs wherever the
    presentation is decided, which is here.

    (If this endpoint ever grows a page limit, revisit: truncating an
    oldest-first list server-side would drop the newest replies entirely, and
    no amount of client sorting recovers messages that were never sent.)

    WHY NOT reverse(). Reversing inherits its correctness from the server's
    sort. Sorting on the date says what we mean, and matches the rule mobile
    already documents -- including the part that matters: an undated message
    sinks to the BOTTOM. It cannot be shown as the latest word in a
    conversation on the strength of a missing header, which is exactly what
    sorting on `timestamp` (which falls back to now) would do.

    filter() has already copied the array, so sorting does not touch the prop
    -- and must not: ThreadSummaryModal reads thread[0] and thread[length-1]
    as the conversation's first and last, off the original.
  */
  const earlier = thread.filter((m) => m.id !== message.id).sort(byNewestFirst);

  /*
    Which earlier messages are open, and the bodies fetched for them.

    Opening one used to REPLACE the whole reading pane with that message,
    which lost the message you were reading and your place in the thread --
    getting back meant finding it again in the list. They expand in place
    instead, so the conversation stays on one screen.

    RESET BY REMOUNTING. There is no reset logic here because there needs to
    be none: the parent keys this component on the open message's id, so
    reading a different message builds a fresh component and this starts empty.
    An effect that cleared it would paint the previous conversation's expanded
    rows for a frame before clearing them, and trips
    react-hooks/set-state-in-effect besides.

    That also removes the need for a stale-response guard below: a fetch still
    in flight when the reader moves on resolves into an unmounted component,
    which React discards, rather than into the next conversation's state.
  */
  const [threadState, setThreadState] = useState<ThreadState>(EMPTY_THREAD_STATE);

  const toggleEarlier = useCallback(
    async (item: WebmailListItem) => {
      if (threadState.expanded.includes(item.id)) {
        setThreadState((prev) => ({
          ...prev,
          expanded: prev.expanded.filter((id) => id !== item.id),
        }));
        return;
      }

      // Fetched once. A second expand reads what is already here, so
      // collapsing and reopening costs nothing.
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

      if (alreadyLoaded || !onLoadThreadMessage) return;

      const loaded = await onLoadThreadMessage(item.id);

      setThreadState((prev) => {
        const loadingId = prev.loadingId === item.id ? null : prev.loadingId;

        if (!loaded) {
          return {
            ...prev,
            loadingId,
            errors: {
              ...prev.errors,
              [item.id]: 'This message could not be loaded. It may have been moved or deleted.',
            },
          };
        }

        return { ...prev, loadingId, bodies: { ...prev.bodies, [item.id]: loaded } };
      });
    },
    [threadState, onLoadThreadMessage],
  );

  // Resolved once per message rather than read from storage on every render.
  // Re-checked when the sender changes, which is what opening a different
  // message means here.
  const senderAllowed = useMemo(
    () => isImageSenderAllowed(message.fromEmail),
    [message.fromEmail],
  );
  const allowRemoteImages = senderAllowed || showImagesOnce;

  // A different message starts blocked again -- "show once" means once.
  //
  // blockedImages is deliberately NOT reset here. React runs child effects
  // before parent effects, so WebmailBodyFrame reports the new message's
  // real count first and a reset in this (parent) effect then clobbered it
  // back to 0 -- on mount and on every message. The "N images blocked --
  // Show images" bar therefore never rendered at all: readers saw the
  // dashed placeholder boxes with no way to load the images and no
  // explanation. The frame re-reports whenever its sanitised output
  // changes, so the count tracks the current message without any reset.
  useEffect(() => {
    setShowImagesOnce(false);
  }, [message.id]);

  const handleBlockedCount = useCallback((count: number) => setBlockedImages(count), []);

  const toolbarButton = (label: string, icon: React.ReactNode, onClick: () => void, danger = false) => (
    <button
      onClick={onClick}
      className={`p-2 rounded-full hover:bg-muted ${
        danger ? 'text-red-500' : 'text-gray-500'
      }`}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 animate-fadeIn">
      <div className="flex flex-col mb-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:bg-muted rounded-full"
            title="Back to list"
            aria-label="Back to list"
          >
            <X size={20} />
          </button>

          <div className="flex items-center space-x-1">
            {toolbarButton('Archive', <Archive size={20} />, () => setShowArchiveModal(true))}
            {toolbarButton('Move to Trash', <Trash2 size={20} />, onTrash)}
            {onDeleteForever &&
              toolbarButton(
                'Delete forever',
                <Trash2 size={20} />,
                () => setShowDeleteForeverModal(true),
                true,
              )}
            {onNotSpam &&
              toolbarButton('Not spam — move to Inbox', <ShieldCheck size={20} />, onNotSpam)}
            {toolbarButton('Move to folder', <FolderInput size={20} />, () => setShowMoveModal(true))}
            <div className="h-6 border-l border-border mx-1" />
            {toolbarButton('Reply', <Reply size={20} />, onReply)}
            {toolbarButton('Reply all', <ReplyAll size={20} />, onReplyAll)}
            {toolbarButton('Forward', <Forward size={20} />, onForward)}
            <button
              onClick={onStar}
              className="p-2 text-gray-500 hover:bg-muted rounded-full"
              title={message.isStarred ? 'Unstar' : 'Star'}
            >
              <Star size={20} className={message.isStarred ? 'fill-amber-400 text-amber-400' : ''} />
            </button>
          </div>
        </div>

        <div className="flex items-center mt-3 gap-2">
          {/* Only when the server reports an AI endpoint. */}
          {onAiWrite && (
            <button
              onClick={() => setShowAiWriter(true)}
              className="flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-800/30 hover:bg-blue-200 dark:hover:bg-blue-700/30 text-blue-700 dark:text-blue-300 rounded-md text-sm"
            >
              <Sparkles size={14} />
              <span>AI Email Writer</span>
            </button>
          )}
          {onSummarize && (
          <button
            onClick={() => setShowThreadSummary(true)}
            className="flex items-center gap-1 px-3 py-1 bg-violet-100 dark:bg-violet-800/30 hover:bg-violet-200 dark:hover:bg-violet-700/30 text-violet-700 dark:text-violet-300 rounded-md text-sm"
          >
            <Hash size={14} />
            <span>Thread Summary</span>
          </button>
          )}
        </div>
      </div>

      <div className="flex-1">
        <div className="mb-6">
          <h1 className="text-xl font-bold mb-3 text-gray-900 dark:text-gray-100">
            {message.subject}
          </h1>

          <div className="flex items-start mb-4">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center mr-3 flex-shrink-0">
              <span className="text-primary font-medium">
                {(message.from || message.fromEmail || '?').charAt(0).toUpperCase()}
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                    {message.from}
                  </div>
                  <div className="text-sm text-gray-500 truncate">{message.fromEmail}</div>
                  {message.to.length > 0 && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      to {message.to.map((p) => p.name || p.email).join(', ')}
                      {message.cc.length > 0 &&
                        `, cc ${message.cc.map((p) => p.name || p.email).join(', ')}`}
                    </div>
                  )}
                </div>
                <div className="text-sm text-gray-500 whitespace-nowrap">
                  {/* Same "Aug 25, 8:24 AM" as before, from date-fns rather
                      than Intl -- see lib/webmail/dates.ts. */}
                  {formatShortDateTime(message.timestamp)}
                </div>
              </div>
            </div>
          </div>

          {/* Above the body, not below it: the one thing a reader needs to
              know about this message is that it has not been sent yet, and
              they need it before they read a word of it. */}
          {scheduled && (
            <div
              className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm ${
                scheduled.failed
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-primary/30 bg-primary/10 text-foreground'
              }`}
            >
              <CalendarClock size={16} className="flex-shrink-0" />
              <span className="flex-1 min-w-[12rem]">
                {scheduled.failed ? (
                  <>
                    <strong className="font-medium">This message was not sent.</strong>
                    {scheduled.error ? ` ${scheduled.error}` : ''}
                  </>
                ) : (
                  <>
                    <strong className="font-medium">Waiting to send.</strong> It goes out{' '}
                    {scheduled.label}.
                  </>
                )}
              </span>
              {onCancelScheduled && (
                <button
                  onClick={onCancelScheduled}
                  className="flex-shrink-0 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-muted"
                >
                  {scheduled.failed ? 'Move to drafts' : 'Cancel send'}
                </button>
              )}
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

          <WebmailBodyFrame
            html={message.body}
            // Decides whether the frame is the sender's canvas or ours: an
            // HTML part renders on white untouched, a plain-text body is our
            // own wrapper and may follow the theme.
            isHtml={message.bodyIsHtml}
            attachments={message.attachments}
            attachmentHref={(index) => attachmentHref(message.id, index)}
            allowRemoteImages={allowRemoteImages}
            onBlockedCount={handleBlockedCount}
          />

          {message.attachments.filter((a) => !a.isInline).length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <h3 className="text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                {message.attachments.filter((a) => !a.isInline).length} attachment
                {message.attachments.filter((a) => !a.isInline).length === 1 ? '' : 's'}
              </h3>
              <div className="flex flex-wrap gap-2">
                {/* Inline images are already shown in the body above; listing
                    them again as downloads is noise, not completeness. */}
                {message.attachments.filter((a) => !a.isInline).map((attachment) => (
                  <AttachmentChip
                    key={attachment.index}
                    attachment={attachment}
                    href={attachmentHref(message.id, attachment.index)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {earlier.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border">
            <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
              Earlier in this conversation ({earlier.length})
            </h3>
            <div className="space-y-2">
              {earlier.map((m) => {
                const expanded = threadState.expanded.includes(m.id);
                const loaded = threadState.bodies[m.id];
                const failed = threadState.errors[m.id];

                return (
                  <div key={m.id} className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => void toggleEarlier(m)}
                      aria-expanded={expanded}
                      className="w-full text-left p-3 hover:bg-muted"
                    >
                      <div className="flex items-center gap-2">
                        {expanded ? (
                          <ChevronDown size={15} className="text-gray-400 flex-shrink-0" />
                        ) : (
                          <ChevronRight size={15} className="text-gray-400 flex-shrink-0" />
                        )}
                        <span className="font-medium text-sm truncate flex-1">{m.from}</span>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {formatDateTime(m.timestamp)}
                        </span>
                      </div>
                      {/* The preview is the closed state's whole value, so it
                          goes away when the real body is on screen below. */}
                      {!expanded && m.preview && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 pl-[23px]">
                          {m.preview}
                        </p>
                      )}
                    </button>

                    {expanded && (
                      <div className="border-t border-border px-3 py-3">
                        {threadState.loadingId === m.id && (
                          <Spinner size="sm" label="Loading message" />
                        )}

                        {failed && (
                          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                            {failed}
                          </p>
                        )}

                        {loaded && (
                          <>
                            {/* Same frame as the message above, so an expanded
                                reply gets the identical sanitising and remote-
                                image blocking. A cheaper render here would be a
                                second, weaker path for the same hostile HTML. */}
                            <WebmailBodyFrame
                              html={loaded.body}
                              isHtml={loaded.bodyIsHtml}
                              attachments={loaded.attachments}
                              attachmentHref={(index) => attachmentHref(loaded.id, index)}
                              allowRemoteImages={allowRemoteImages}
                              // onBlockedCount is deliberately NOT passed. It
                              // drives the single "N images blocked" bar for
                              // the message above, and an expanded reply
                              // reporting into it would overwrite that count
                              // with its own.
                            />

                            {loaded.attachments.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {loaded.attachments.map((attachment) => (
                                  <AttachmentChip
                                    key={`${loaded.id}-${attachment.index}`}
                                    attachment={attachment}
                                    href={attachmentHref(loaded.id, attachment.index)}
                                  />
                                ))}
                              </div>
                            )}

                            {/* The old behaviour, kept as a deliberate choice
                                rather than the only one: some readers do want
                                the full pane, with its own reply and move
                                actions. */}
                            <button
                              onClick={() => onOpenMessage(m)}
                              className="mt-3 text-xs text-primary hover:underline underline-offset-2"
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

        <div className="mt-8 pt-6 border-t border-border">
          <button
            onClick={onReply}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-border text-gray-600 dark:text-gray-300 hover:bg-muted"
          >
            <Reply size={16} />
            Reply to {message.from}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={showArchiveModal}
        onClose={() => setShowArchiveModal(false)}
        onConfirm={onArchive}
        icon={<Archive size={20} />}
        title="Archive message"
        body={
          <>
            Move <span className="font-medium">&ldquo;{message.subject}&rdquo;</span> to Archive?
            You can find it there later.
          </>
        }
        confirmLabel="Archive"
      />

      {onDeleteForever && (
        <ConfirmModal
          isOpen={showDeleteForeverModal}
          onClose={() => setShowDeleteForeverModal(false)}
          onConfirm={onDeleteForever}
          icon={<Trash2 size={20} />}
          tone="danger"
          title="Delete forever"
          body={
            <>
              <span className="font-medium">&ldquo;{message.subject}&rdquo;</span> will be erased
              from the mail server. This cannot be undone.
            </>
          }
          confirmLabel="Delete forever"
          typedConfirmation="DELETE"
        />
      )}

      <MoveEmailModal
        isOpen={showMoveModal}
        onClose={() => setShowMoveModal(false)}
        onMove={onMove}
        label={message.subject}
        currentFolder={message.folder}
        folders={folders}
      />

      {onAiWrite && (
        <AiWriterModal
          isOpen={showAiWriter}
          onClose={() => setShowAiWriter(false)}
          onGenerate={(prompt) => onAiWrite(prompt, '')}
          onApply={onComposeWithBody}
        />
      )}

      {onSummarize && (
        <ThreadSummaryModal
          isOpen={showThreadSummary}
          onClose={() => setShowThreadSummary(false)}
          thread={thread.length > 0 ? thread : [message]}
          onSummarize={onSummarize}
        />
      )}
    </div>
  );
}
