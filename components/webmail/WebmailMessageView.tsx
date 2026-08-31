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
} from 'lucide-react';
import type { WebmailAttachment, WebmailFolder, WebmailListItem, WebmailMessage } from './types';
import WebmailBodyFrame, { BlockedImagesBar } from './WebmailBodyFrame';
import { allowImageSender, isImageSenderAllowed } from '@/lib/webmail/sanitize';
import { formatDateTime, formatShortDateTime } from '@/lib/webmail/dates';
import ConfirmModal from './modals/ConfirmModal';
import MoveEmailModal from './modals/MoveEmailModal';
import AiWriterModal from './modals/AiWriterModal';
import ThreadSummaryModal from './modals/ThreadSummaryModal';

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
};

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
      className="inline-flex items-center gap-2 max-w-xs px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
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
}: WebmailMessageViewProps) {
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showDeleteForeverModal, setShowDeleteForeverModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showAiWriter, setShowAiWriter] = useState(false);
  const [showThreadSummary, setShowThreadSummary] = useState(false);
  const [blockedImages, setBlockedImages] = useState(0);
  const [showImagesOnce, setShowImagesOnce] = useState(false);

  const earlier = thread.filter((m) => m.id !== message.id);

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
      className={`p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 ${
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
      <div className="flex flex-col mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
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
            {toolbarButton('Move to folder', <FolderInput size={20} />, () => setShowMoveModal(true))}
            <div className="h-6 border-l border-gray-200 dark:border-gray-700 mx-1" />
            {toolbarButton('Reply', <Reply size={20} />, onReply)}
            {toolbarButton('Reply all', <ReplyAll size={20} />, onReplyAll)}
            {toolbarButton('Forward', <Forward size={20} />, onForward)}
            <button
              onClick={onStar}
              className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"
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
            attachments={message.attachments}
            attachmentHref={(index) => attachmentHref(message.id, index)}
            allowRemoteImages={allowRemoteImages}
            onBlockedCount={handleBlockedCount}
          />

          {message.attachments.filter((a) => !a.isInline).length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
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
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
              Earlier in this conversation ({earlier.length})
            </h3>
            <div className="space-y-2">
              {earlier.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onOpenMessage(m)}
                  className="w-full text-left border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-sm truncate">{m.from}</span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {formatDateTime(m.timestamp)}
                    </span>
                  </div>
                  {m.preview && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {m.preview}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onReply}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
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
