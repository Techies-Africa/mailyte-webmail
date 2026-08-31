import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Minimize2, Maximize2, Send, Sparkles, Trash2, Paperclip, Undo2 } from 'lucide-react';
import { motion } from 'framer-motion';
import type {
  ComposeDraft,
  ComposeMode,
  SendResult,
  WebmailContact,
  WebmailMessage,
} from './types';
import WebmailEditor from './WebmailEditor';
import WebmailRecipientInput from './WebmailRecipientInput';
import { formatTime } from '@/lib/webmail/dates';
import {
  forwardSubject,
  quotedBody,
  replyAllRecipients,
  replyRecipients,
  replySubject,
} from './composeQuoting';

export type ComposePayload = ComposeDraft & {
  inReplyTo?: string;
  references?: string;
  attachments?: File[];
};

/**
 * Matches SendMailboxMessageRequest's own limits, so the user is told before
 * paying for an upload rather than after Postfix rejects the message.
 */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type WebmailComposeProps = {
  mode: ComposeMode;
  replyTo?: WebmailMessage;
  /** The signed-in mailbox, so Reply-All never addresses the sender to themselves. */
  selfAddress: string;
  initialValues?: Partial<ComposeDraft>;
  onClose: () => void;
  onSent: () => void;
  onSend: (payload: ComposePayload) => Promise<SendResult>;
  /**
   * Absent when the server reports no AI endpoint (GET
   * /mailbox/capabilities). The control is then not rendered at all rather
   * than rendered and failing -- a deployment with no AI configured used to
   * show this button and answer "Could not generate a draft. Please try
   * again.", which describes a temporary fault rather than a feature that was
   * never available.
   */
  onAiWrite?: (instruction: string, existingBody: string) => Promise<string>;
  /**
   * Persist the draft, returning the id it was saved as. Called on a timer
   * and on close; omitted only where there is nowhere to save to.
   */
  onSaveDraft?: (payload: ComposePayload, replaceId?: string) => Promise<string | null>;
  onDiscardDraft?: (id: string) => Promise<void>;
  /** The draft being resumed, if this compose was opened from one. */
  existingDraftId?: string;
  /** Autocomplete suggestions for the recipient fields (C2). */
  contacts?: WebmailContact[];
};

/** PRD F6: "autosave every 30s + on close". */
const AUTOSAVE_MS = 30_000;

function initialDraft(
  mode: ComposeMode,
  replyTo: WebmailMessage | undefined,
  selfAddress: string,
  initialValues: Partial<ComposeDraft> | undefined,
): ComposeDraft {
  const base: ComposeDraft = { to: '', cc: '', bcc: '', subject: '', body: '' };

  if (replyTo && (mode === 'reply' || mode === 'replyAll')) {
    base.subject = replySubject(replyTo.subject);
    if (mode === 'replyAll') {
      const { to, cc } = replyAllRecipients(replyTo, selfAddress);
      base.to = to;
      base.cc = cc;
    } else {
      base.to = replyRecipients(replyTo);
    }
  } else if (replyTo && mode === 'forward') {
    base.subject = forwardSubject(replyTo.subject);
  }

  return { ...base, ...initialValues };
}

export default function WebmailCompose({
  mode,
  replyTo,
  selfAddress,
  initialValues,
  onClose,
  onSent,
  onSend,
  onAiWrite,
  onSaveDraft,
  onDiscardDraft,
  existingDraftId,
  contacts = [],
}: WebmailComposeProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showCc, setShowCc] = useState(!!initialValues?.cc);
  const [showBcc, setShowBcc] = useState(!!initialValues?.bcc);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [showAiPrompt, setShowAiPrompt] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<ComposeDraft>(() =>
    initialDraft(mode, replyTo, selfAddress, initialValues),
  );

  const [draftId, setDraftId] = useState<string | undefined>(existingDraftId);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  // Refs, not state: the autosave timer and the unload guard both need the
  // CURRENT draft, and reading it from state would mean re-subscribing them
  // on every keystroke.
  const draftRef = useRef<ComposeDraft>(draft);
  const draftIdRef = useRef<string | undefined>(existingDraftId);
  const dirtyRef = useRef(false);
  const sentRef = useRef(false);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  const dragRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const quoted = useMemo(() => (replyTo ? quotedBody(mode, replyTo) : ''), [mode, replyTo]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    dirtyRef.current = true;
    setDraft((prev) => ({ ...prev, [name]: value }));
  };

  /**
   * What the editor starts with: whatever was passed in (a resumed draft, or
   * an AI-generated body) followed by the quotation for a reply or forward.
   *
   * TipTap owns its document from here, so this is read once. `editorSeed`
   * is bumped when something outside the editor legitimately replaces the
   * whole body -- currently only the AI writer -- which remounts it with the
   * new content rather than fighting the editor's own state.
   */
  const initialEditorHtml = useMemo(
    () => (initialValues?.body ?? '') + quoted,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [editorSeed, setEditorSeed] = useState(0);
  const [seededHtml, setSeededHtml] = useState<string | null>(null);

  // Seed the draft body with the starting content, so a reply that is sent
  // untouched still carries its quotation.
  useEffect(() => {
    if (initialEditorHtml) {
      setDraft((prev) => ({ ...prev, body: initialEditorHtml }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const dragElement = dragRef.current;
    if (!dragElement) return;

    const onMouseDown = (e: MouseEvent) => {
      // Dragging a full-screen sheet around makes no sense, and on a phone
      // the same gesture is a scroll.
      if (isMaximized || isMobile) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const { x: startLeft, y: startTop } = positionRef.current;

      const onMouseMove = (move: MouseEvent) => {
        const next = {
          x: startLeft + (move.clientX - startX),
          y: startTop + (move.clientY - startY),
        };
        positionRef.current = next;
        setPosition(next);
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    dragElement.addEventListener('mousedown', onMouseDown);
    return () => dragElement.removeEventListener('mousedown', onMouseDown);
  }, [isMaximized, isMobile]);

  /**
   * Is there anything here worth saving? A reply opens pre-filled with a
   * subject, recipients and a quotation, none of which the user typed --
   * autosaving that immediately would litter Drafts with a draft for every
   * Reply button ever pressed.
   */
  const worthSaving = useCallback(() => {
    if (!dirtyRef.current || sentRef.current || !onSaveDraft) return false;
    const current = draftRef.current;
    const bodyText = current.body.replace(/<[^>]*>/g, '').trim();
    return !!(current.to.trim() || current.subject.trim() || bodyText);
  }, [onSaveDraft]);

  const persistDraft = useCallback(async () => {
    if (!worthSaving() || !onSaveDraft) return;

    setSavingDraft(true);
    try {
      const isReply = (mode === 'reply' || mode === 'replyAll') && !!replyTo;
      const saved = await onSaveDraft(
        {
          ...draftRef.current,
          inReplyTo: isReply ? (replyTo?.messageIdHeader ?? undefined) : undefined,
          references: isReply ? (replyTo?.references ?? undefined) : undefined,
        },
        draftIdRef.current,
      );
      if (saved) {
        setDraftId(saved);
        draftIdRef.current = saved;
        setDraftSavedAt(new Date());
        dirtyRef.current = false;
      }
    } finally {
      setSavingDraft(false);
    }
  }, [mode, replyTo, worthSaving, onSaveDraft]);

  // Autosave on a timer (F6). The interval is fixed rather than debounced
  // per keystroke so a long uninterrupted paragraph is still saved.
  useEffect(() => {
    if (!onSaveDraft) return;
    const interval = setInterval(() => void persistDraft(), AUTOSAVE_MS);
    return () => clearInterval(interval);
  }, [onSaveDraft, persistDraft]);

  /**
   * The beforeunload guard (F6). Browsers ignore any custom text here and
   * show their own wording, and they only honour the prompt at all if the
   * page has been interacted with -- both fine: the point is that closing a
   * tab mid-message asks first. There is no reliable way to complete an
   * async save during unload, so this warns rather than pretending to save.
   */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || sentRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  /** Closing the window: save what's there first, then let it go. */
  const closeWithSave = async () => {
    await persistDraft();
    onClose();
  };

  const generateAIContent = async () => {
    setIsGeneratingAI(true);
    try {
      if (!onAiWrite) return;
      const generated = await onAiWrite(aiPrompt, draft.body);
      // Remount the editor around the generated body: the AI writer replaces
      // the whole document, which is the one case where reaching past
      // TipTap's own state is the correct thing to do.
      dirtyRef.current = true;
      setSeededHtml(generated + quoted);
      setDraft((prev) => ({ ...prev, body: generated + quoted }));
      setEditorSeed((n) => n + 1);
      setShowAiPrompt(false);
      setAiPrompt('');
    } catch {
      setSendError('Could not generate a draft. Please try again.');
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const attachedBytes = attachments.reduce((sum, file) => sum + file.size, 0);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSendError(null);

    const incoming = Array.from(files);
    const tooBig = incoming.find((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      setSendError(
        `"${tooBig.name}" is ${formatBytes(tooBig.size)} — the limit is 25 MB per file.`,
      );
      return;
    }
    if (attachments.length + incoming.length > MAX_ATTACHMENTS) {
      setSendError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    if (attachedBytes + incoming.reduce((s, f) => s + f.size, 0) > MAX_ATTACHMENT_BYTES) {
      setSendError('Attachments total more than 25 MB.');
      return;
    }

    setAttachments((prev) => [...prev, ...incoming]);
  };

  const handleSend = async () => {
    setSendError(null);
    setIsSending(true);
    try {
      const isReply = (mode === 'reply' || mode === 'replyAll') && !!replyTo;
      const result = await onSend({
        ...draft,
        // The real RFC 822 Message-Id, never the JMAP resource id -- no other
        // mail client's threading recognises the latter.
        inReplyTo: isReply ? (replyTo?.messageIdHeader ?? undefined) : undefined,
        references: isReply ? (replyTo?.references ?? undefined) : undefined,
        attachments,
      });
      if (!result.success) {
        setSendError(result.message ?? 'Could not send this message');
        return;
      }
      // The message is sent; its draft is not a draft any more. Clear the
      // dirty flag first so the unload guard doesn't fire on the close.
      sentRef.current = true;
      dirtyRef.current = false;
      const saved = draftIdRef.current;
      if (saved && onDiscardDraft) void onDiscardDraft(saved);

      onSent();
    } finally {
      setIsSending(false);
    }
  };

  // C5: under 768px the floating 700x600 window becomes a full-screen
  // sheet. The old fixed size made compose unusable on a phone -- most of
  // it was off-screen and the drag handle could not bring it back.
  const windowStyle =
    isMobile || isMaximized
      ? { position: 'fixed' as const, inset: 0, zIndex: 50, transform: 'none' }
      : isMinimized
        ? { position: 'fixed' as const, bottom: 0, right: '2rem', zIndex: 50, transform: 'none' }
        : {
            position: 'fixed' as const,
            bottom: '2rem',
            right: '2rem',
            zIndex: 50,
            transform: `translate(${position.x}px, ${position.y}px)`,
          };

  const title =
    mode === 'reply'
      ? 'Reply'
      : mode === 'replyAll'
        ? 'Reply all'
        : mode === 'forward'
          ? 'Forward'
          : 'New message';

  return (
    <motion.div
      className={`flex flex-col bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 ${
        isMobile || isMaximized
          ? 'w-full h-full rounded-none'
          : isMinimized
            ? 'w-80 rounded-t-lg'
            : 'w-[700px] h-[600px] rounded-t-lg'
      }`}
      style={windowStyle}
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      transition={{ duration: 0.3 }}
    >
      <div
        ref={dragRef}
        className={`flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 ${
          isMobile || isMaximized ? '' : 'cursor-move rounded-t-lg'
        }`}
      >
        <h3 className="font-medium text-gray-700 dark:text-gray-300">{title}</h3>
        <div className="flex items-center space-x-2">
          {!isMobile && (
          <button
            onClick={() => {
              setIsMinimized((v) => !v);
              setIsMaximized(false);
            }}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 p-1"
            title={isMinimized ? 'Restore' : 'Minimize'}
          >
            <Minimize2 size={16} />
          </button>
          )}
          {!isMobile && (
          <button
            onClick={() => {
              setIsMaximized((v) => !v);
              setIsMinimized(false);
            }}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 p-1"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          )}
          <button
            onClick={() => void closeWithSave()}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 p-1"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {isMinimized ? (
        <div className="p-3 truncate">{draft.subject || 'New message'}</div>
      ) : (
        <>
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            {sendError && (
              <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {sendError}
              </div>
            )}

            <div className="mb-3 -mx-4 border-t border-gray-100 dark:border-gray-700">
              <WebmailRecipientInput
                label="To"
                value={draft.to}
                onChange={(value) => {
                  dirtyRef.current = true;
                  setDraft((prev) => ({ ...prev, to: value }));
                }}
                contacts={contacts}
                autoFocus={mode === 'compose'}
                trailing={
                  <div className="flex gap-2 pr-1">
                    <button
                      onClick={() => setShowCc((v) => !v)}
                      className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      {showCc ? 'Hide Cc' : 'Cc'}
                    </button>
                    <button
                      onClick={() => setShowBcc((v) => !v)}
                      className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      {showBcc ? 'Hide Bcc' : 'Bcc'}
                    </button>
                  </div>
                }
              />

              {showCc && (
                <WebmailRecipientInput
                  label="Cc"
                  value={draft.cc}
                  onChange={(value) => {
                    dirtyRef.current = true;
                    setDraft((prev) => ({ ...prev, cc: value }));
                  }}
                  contacts={contacts}
                />
              )}

              {showBcc && (
                <WebmailRecipientInput
                  label="Bcc"
                  value={draft.bcc}
                  onChange={(value) => {
                    dirtyRef.current = true;
                    setDraft((prev) => ({ ...prev, bcc: value }));
                  }}
                  contacts={contacts}
                />
              )}

              <div className="flex items-center px-3 py-1.5 border-b border-gray-200 dark:border-gray-700">
                <span className="text-sm text-gray-500 dark:text-gray-400 w-10 flex-shrink-0">
                  Subj
                </span>
                <input
                  type="text"
                  name="subject"
                  value={draft.subject}
                  onChange={handleInputChange}
                  placeholder="Subject"
                  className="flex-1 bg-transparent border-0 focus:ring-0 p-0 py-1 text-sm"
                />
              </div>
            </div>

            <WebmailEditor
              key={editorSeed}
              initialHtml={seededHtml ?? initialEditorHtml}
              onChange={(html) => {
                dirtyRef.current = true;
                setDraft((prev) => ({ ...prev, body: html }));
              }}
              // Not rendered at all when the server has no AI endpoint.
              toolbarExtra={
                onAiWrite ? (
                <button
                  onClick={() => setShowAiPrompt(true)}
                  className="flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-800/30 hover:bg-blue-200 dark:hover:bg-blue-700/30 text-blue-700 dark:text-blue-300 rounded-md text-sm"
                >
                  <Sparkles size={14} />
                  <span>AI Write</span>
                </button>
                ) : undefined
              }
            />
          </div>

          {attachments.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-2">
              {attachments.map((file, index) => (
                <span
                  key={`${file.name}-${index}`}
                  className="inline-flex items-center gap-2 max-w-full pl-2 pr-1 py-1 bg-gray-100 dark:bg-gray-700 rounded text-sm text-gray-700 dark:text-gray-200"
                >
                  <Paperclip size={13} className="flex-shrink-0 text-gray-400" />
                  <span className="truncate">{file.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                    className="p-0.5 rounded hover:bg-gray-300 dark:hover:bg-gray-600 flex-shrink-0"
                    title={`Remove ${file.name}`}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
              <span className="self-center text-xs text-gray-400">
                {formatBytes(attachedBytes)} of 25 MB
              </span>
            </div>
          )}

          <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-700">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (!window.confirm('Discard this message?')) return;
                  // Discard means discard: an autosaved revision left in
                  // Drafts after the user said "discard" is the message they
                  // just asked to be rid of, sitting in a folder.
                  dirtyRef.current = false;
                  sentRef.current = true;
                  const saved = draftIdRef.current;
                  if (saved && onDiscardDraft) void onDiscardDraft(saved);
                  onClose();
                }}
                className="flex items-center text-gray-500 hover:text-red-500"
              >
                <Trash2 size={16} className="mr-1" />
                <span className="text-sm">Discard</span>
              </button>

              {/* Attaching files works now (PRD P7). This control existed
                  before and was disabled in the real webmail while staying
                  enabled in the mock -- there was no upload endpoint behind
                  it either way. */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                title="Attach files"
              >
                <Paperclip size={16} className="mr-1" />
                <span className="text-sm">Attach</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  // Reset so re-picking the same file fires change again.
                  e.target.value = '';
                }}
              />
            </div>

            <div className="flex items-center gap-3">
              {onSaveDraft && (savingDraft || draftSavedAt) && (
                <span className="text-xs text-gray-400">
                  {savingDraft
                    ? 'Saving…'
                    : `Draft saved ${draftSavedAt ? formatTime(draftSavedAt) : ''}`}
                </span>
              )}
              <button
                onClick={handleSend}
                disabled={isSending || !draft.to.trim()}
                className="px-4 py-2 bg-primary text-black rounded-md flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSending ? (
                  <span className="animate-spin h-4 w-4 border-2 border-black border-t-transparent rounded-full mr-2" />
                ) : (
                  <Send size={16} className="mr-2" />
                )}
                {isSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </>
      )}

      {showAiPrompt && onAiWrite && (
        <div className="absolute inset-0 bg-black/50 z-10 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg w-[500px] max-w-full">
            <h3 className="text-lg font-medium mb-4 flex items-center">
              <Sparkles size={18} className="text-blue-500 mr-2" />
              AI Write
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Describe what to say. Your existing text is used as context.
            </p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. politely decline and suggest next week instead"
              className="w-full h-32 p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent focus:ring-2 focus:ring-primary/20 mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowAiPrompt(false)}
                className="px-4 py-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={generateAIContent}
                className="px-4 py-2 bg-primary text-black rounded-md hover:bg-primary/90 flex items-center disabled:opacity-50"
                disabled={isGeneratingAI || !aiPrompt.trim()}
              >
                {isGeneratingAI ? (
                  <>
                    <span className="animate-spin h-4 w-4 border-2 border-black border-t-transparent rounded-full mr-2" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} className="mr-2" />
                    Generate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
