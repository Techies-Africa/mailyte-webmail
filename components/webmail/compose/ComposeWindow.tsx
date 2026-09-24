'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Paperclip, Send, Sparkles, Square, Trash2, X } from 'lucide-react';
import type { ComposeDraft, ComposeMode, SendResult, WebmailContact } from '../types';
import type { ComposePayload, ComposeWindow as ComposeWindowModel, FromOption } from './types';
import WebmailEditor from '../WebmailEditor';
import WebmailRecipientInput from '../WebmailRecipientInput';
import ScheduleSendMenu from '../ScheduleSendMenu';
import AiWriterModal from '../modals/AiWriterModal';
import ConfirmModal from '../modals/ConfirmModal';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import { formatTime } from '@/lib/webmail/dates';
import { forwardSubject, quotedBody, replyAllRecipients, replyRecipients, replySubject } from '../composeQuoting';
import { useDockDrag, type DockDragCallbacks } from './useDockDrag';
import { useVisualViewport } from '@/lib/webmail/useVisualViewport';

/** Matches SendMailboxMessageRequest's own limits. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;

/** PRD F6: autosave every 30s + on close. */
const AUTOSAVE_MS = 30_000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MODE_TITLE: Record<ComposeMode, string> = {
  compose: 'New message',
  reply: 'Reply',
  replyAll: 'Reply all',
  forward: 'Forward',
};

function initialDraft(
  mode: ComposeMode,
  replyTo: ComposeWindowModel['replyTo'],
  selfAddress: string,
  resumed: ComposeWindowModel['resumed'],
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

  return { ...base, ...resumed };
}

type ComposeWindowProps = {
  window: ComposeWindowModel;
  /** A minimized window's tab is drawn by the dock, in this window's slot; this window is then `hidden`. */
  layout: 'open' | 'fullscreen';
  /** Minimized, or on a phone not the window in front: kept mounted, not shown. */
  hidden?: boolean;
  /** Its slot's distance from the right edge of the screen, px (dockLayout). Ignored in full screen. */
  right: number;
  /** Its slot's width, px. */
  width: number;
  /** Above the windows used less recently than this one. */
  zIndex: number;
  /** Whether the title bar drags the window along the row, and Alt+Shift+Arrow moves it. */
  canReorder: boolean;
  /** Focused or pressed: raise it to the top of the stack, without moving it. */
  onActivate: () => void;
  /** A drag of the title bar, reported to the dock, which reorders the row. */
  drag: DockDragCallbacks;
  /** Alt+Shift+Arrow: one slot further from the right edge (+1) or nearer it (-1). */
  onMoveBy: (delta: 1 | -1) => void;
  isMobile: boolean;
  selfAddress: string;
  selfName: string | null;
  /** Shared mailboxes this session may send as. Empty = no From picker. */
  fromOptions: FromOption[];
  contacts: WebmailContact[];
  canSchedule: boolean;
  onAiWrite?: (instruction: string, existingBody: string) => Promise<string>;
  onClose: () => void;
  onMinimize: () => void;
  onFullscreen: () => void;
  onRestore: () => void;
  onLabelChange: (label: string) => void;
  onDraftId: (draftId: string) => void;
  /** How many files are attached, so the page can warn before they are lost. */
  onAttachmentsChange?: (count: number) => void;
  onSend: (payload: ComposePayload) => Promise<SendResult>;
  onSaveDraft: (payload: ComposePayload, replaceId?: string) => Promise<string | null>;
  onDiscardDraft: (id: string) => Promise<void>;
};

/**
 * One compose window, in the redesign's two shapes: a 560px sheet rising
 * from the bottom edge with a dark title bar, or a full-screen page with a
 * dark top bar and an 800px column. Both wrap the same form.
 *
 * Docked, it sits in one slot of the dock's single ordered row, at the
 * `right` the dock hands down, and glides when a neighbour's slot changes.
 * It never picks its own place: minimizing hides it and the dock draws a tab
 * in the same slot, and a new window opens at the left end of the row, so
 * this one stays put. Its title bar drags it along the row, and
 * Alt+Shift+Arrow on a title-bar control moves it one slot. Focusing or
 * pressing anywhere in it raises it above its neighbours without moving it.
 */
export default function ComposeWindow({
  window: model,
  layout,
  hidden = false,
  right,
  width,
  zIndex,
  canReorder,
  onActivate,
  drag: dragCallbacks,
  onMoveBy,
  isMobile,
  selfAddress,
  selfName,
  fromOptions,
  contacts,
  canSchedule,
  onAiWrite,
  onClose,
  onMinimize,
  onFullscreen,
  onRestore,
  onLabelChange,
  onDraftId,
  onAttachmentsChange,
  onSend,
  onSaveDraft,
  onDiscardDraft,
}: ComposeWindowProps) {
  const { mode, replyTo, resumed, initialBody, draftId: existingDraftId } = model;
  // A message put back by Undo or Reopen keeps the address it was going from,
  // if this session may still send as it.
  const restoredFrom =
    model.from && fromOptions.some((option) => option.address === model.from) ? model.from : selfAddress;
  const fullscreen = layout === 'fullscreen' || isMobile;
  // On a phone, the part of the screen the keyboard leaves (iOS lays it over
  // the page): the window is sized to it so Send stays above the keyboard.
  // Only for the window in front -- a hidden one has nothing to keep visible.
  const visible = useVisualViewport(fullscreen && isMobile && !hidden);

  const [draft, setDraft] = useState<ComposeDraft>(() => initialDraft(mode, replyTo, selfAddress, resumed));
  const [showCc, setShowCc] = useState(!!resumed?.cc);
  const [showBcc, setShowBcc] = useState(!!resumed?.bcc);
  const [from, setFrom] = useState(restoredFrom);
  const [isSending, setIsSending] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>(model.attachments ?? []);
  const [showAi, setShowAi] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The whole window moves with a drag of its title bar. Never in full
  // screen: it covers the row, and its slot waits for it underneath.
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useDockDrag({
    enabled: canReorder && !fullscreen,
    rootRef,
    right,
    callbacks: dragCallbacks,
  });

  // Leaving full screen lands the window in its slot at once. Full screen
  // sits at right: 0, so the slot's `right` transition would otherwise slide
  // it in from the corner. The style is flushed with the transition off,
  // then the transition is handed back for the neighbours' next move.
  const wasFullscreenRef = useRef(fullscreen);
  useLayoutEffect(() => {
    const was = wasFullscreenRef.current;
    wasFullscreenRef.current = fullscreen;
    const el = rootRef.current;
    if (!was || fullscreen || !el) return;
    el.style.transition = 'none';
    el.getBoundingClientRect();
    el.style.transition = '';
  }, [fullscreen]);

  const [draftId, setDraftId] = useState<string | undefined>(existingDraftId);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  // Refs, not state: the autosave timer and the unload guard need the CURRENT
  // draft without re-subscribing on every keystroke.
  const draftRef = useRef<ComposeDraft>(draft);
  const draftIdRef = useRef<string | undefined>(existingDraftId);
  // A restored message counts as edited: it exists nowhere else as it is now.
  const dirtyRef = useRef(!!model.restored);
  const sentRef = useRef(false);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  // The dock tab and the title bar follow the subject. The callback is read
  // through a ref so the effect runs when the SUBJECT changes, not whenever
  // the parent hands down a fresh arrow function.
  const onLabelChangeRef = useRef(onLabelChange);
  useEffect(() => {
    onLabelChangeRef.current = onLabelChange;
  }, [onLabelChange]);
  useEffect(() => {
    onLabelChangeRef.current(draft.subject.trim() || MODE_TITLE[mode]);
  }, [draft.subject, mode]);

  // A restored message already carries its quotation in initialBody.
  const quoted = useMemo(
    () => (replyTo && !model.quoteIncluded ? quotedBody(mode, replyTo) : ''),
    [mode, replyTo, model.quoteIncluded],
  );

  /**
   * What the editor starts with: whatever was passed in followed by the
   * quotation for a reply or forward. TipTap owns its document from here.
   * `editorSeed` remounts it when the AI writer replaces the whole body.
   */
  const initialEditorHtml = useMemo(
    () => (initialBody ?? '') + quoted,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [editorSeed, setEditorSeed] = useState(0);
  const [seededHtml, setSeededHtml] = useState<string | null>(null);

  /**
   * What the editor is handed as its starting HTML, fixed per mount.
   *
   * MUST be stable between renders: TipTap re-applies a changed `content`
   * option, which fires onUpdate, which sets the draft, which changes the
   * prop again -- "Maximum update depth exceeded" on the first keystroke.
   * So it is recomputed only when the editor is deliberately remounted
   * (editorSeed), and at that moment it takes the CURRENT body, so an AI
   * replacement or a remount never loses what was typed.
   */
  const editorInitialHtml = useMemo(
    () => seededHtml ?? (draftRef.current.body || initialEditorHtml),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorSeed],
  );

  // Seed the draft body with the starting content, so a reply that is sent
  // untouched still carries its quotation.
  useEffect(() => {
    if (initialEditorHtml) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft((prev) => ({ ...prev, body: initialEditorHtml }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Is there anything here worth saving? A reply opens pre-filled with a
   * subject, recipients and a quotation, none of which the user typed --
   * autosaving that immediately would litter Drafts.
   */
  const worthSaving = useCallback(() => {
    if (!dirtyRef.current || sentRef.current) return false;
    const current = draftRef.current;
    const bodyText = current.body.replace(/<[^>]*>/g, '').trim();
    return !!(current.to.trim() || current.subject.trim() || bodyText);
  }, []);

  const persistDraft = useCallback(async () => {
    if (!worthSaving()) return;
    setSavingDraft(true);
    try {
      const isReply = (mode === 'reply' || mode === 'replyAll') && !!replyTo;
      const saved = await onSaveDraft(
        {
          ...draftRef.current,
          inReplyTo: isReply ? (replyTo?.messageIdHeader ?? undefined) : model.threading?.inReplyTo,
          references: isReply ? (replyTo?.references ?? undefined) : model.threading?.references,
        },
        draftIdRef.current,
      );
      if (saved) {
        setDraftId(saved);
        draftIdRef.current = saved;
        onDraftId(saved);
        setDraftSavedAt(new Date());
        dirtyRef.current = false;
      }
    } finally {
      setSavingDraft(false);
    }
  }, [mode, replyTo, worthSaving, onSaveDraft, onDraftId]);

  // Autosave on a fixed timer (F6), so a long uninterrupted paragraph is
  // still saved.
  useEffect(() => {
    const interval = setInterval(() => void persistDraft(), AUTOSAVE_MS);
    return () => clearInterval(interval);
  }, [persistDraft]);

  // The beforeunload guard (F6): closing the tab mid-message asks first.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || sentRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const onAttachmentsChangeRef = useRef(onAttachmentsChange);
  useEffect(() => {
    onAttachmentsChangeRef.current = onAttachmentsChange;
  }, [onAttachmentsChange]);
  useEffect(() => {
    onAttachmentsChangeRef.current?.(sentRef.current ? 0 : attachments.length);
  }, [attachments.length]);
  // Gone from the screen, the files are gone too; nothing left to warn about.
  useEffect(() => () => onAttachmentsChangeRef.current?.(0), []);

  // Moving to Calendar, Contacts or Settings is a client-side navigation: it
  // unmounts this window without a beforeunload, so the guard above never
  // asks. Save what was written instead, so it is waiting in Drafts.
  const persistDraftRef = useRef(persistDraft);
  useEffect(() => {
    persistDraftRef.current = persistDraft;
  }, [persistDraft]);
  useEffect(() => () => void persistDraftRef.current(), []);
  // Minimizing saves too, as it did when a minimized window was unmounted:
  // what is in Drafts matches what was on screen when it went away.
  useEffect(() => {
    if (hidden) void persistDraftRef.current();
  }, [hidden]);

  const closeWithSave = async () => {
    await persistDraft();
    onClose();
  };

  const touch = (patch: Partial<ComposeDraft>) => {
    dirtyRef.current = true;
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const attachedBytes = attachments.reduce((sum, file) => sum + file.size, 0);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSendError(null);
    const incoming = Array.from(files);
    const tooBig = incoming.find((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      setSendError(`"${tooBig.name}" is ${formatBytes(tooBig.size)} — the limit is 25 MB per file.`);
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

  const sendDisabled = isSending || !draft.to.trim();

  const handleSend = async (sendAt?: Date) => {
    setSendError(null);
    setScheduling(!!sendAt);
    setIsSending(true);
    try {
      const isReply = (mode === 'reply' || mode === 'replyAll') && !!replyTo;
      const result = await onSend({
        ...draft,
        // A resumed reply draft has no replyTo, but keeps the thread it was saved in.
        inReplyTo: isReply ? (replyTo?.messageIdHeader ?? undefined) : model.threading?.inReplyTo,
        references: isReply ? (replyTo?.references ?? undefined) : model.threading?.references,
        attachments,
        sendAt: sendAt?.toISOString(),
        from: from !== selfAddress ? from : undefined,
        draftId: draftIdRef.current,
      });
      if (!result.success) {
        setSendError(result.message ?? 'Could not send this message');
        return;
      }
      // Handed over. Its draft stays in Drafts until the message has really
      // gone (useMailbox removes it then), so an undone or failed send loses
      // nothing. Clear the dirty flag first so the unload guard stays quiet.
      sentRef.current = true;
      dirtyRef.current = false;
      onClose();
    } finally {
      setIsSending(false);
      setScheduling(false);
    }
  };

  const discard = () => {
    // Discard means discard: an autosaved revision left in Drafts after
    // "discard" is the message they just asked to be rid of.
    dirtyRef.current = false;
    sentRef.current = true;
    const saved = draftIdRef.current;
    if (saved) void onDiscardDraft(saved);
    onClose();
  };

  const title = draft.subject.trim() || MODE_TITLE[mode];

  // The keyboard's way to reorder: from any control in the title bar. The
  // row's slots count from the right edge, so ArrowLeft is +1.
  const onTitleKeyDown = (event: React.KeyboardEvent) => {
    if (!canReorder || fullscreen || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onMoveBy(event.key === 'ArrowLeft' ? 1 : -1);
  };

  const titleBar = (
    <div
      className={[
        'flex shrink-0 select-none items-center justify-between bg-sidebar text-white',
        fullscreen
          ? 'px-4 py-3 sm:px-6'
          : `rounded-t-2xl px-4 pb-2.5 pt-3 ${canReorder ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-default'}`,
      ].join(' ')}
      {...(fullscreen ? {} : drag.handleProps)}
      onKeyDown={onTitleKeyDown}
      onDoubleClick={() => {
        // The two clicks of a drop are not a request for full screen.
        if (drag.justDropped()) return;
        if (fullscreen) onRestore();
        else onFullscreen();
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={selfName ?? selfAddress} email={selfAddress} size={fullscreen ? 34 : 30} onDark className="!bg-primary !text-primary-foreground" />
        <div className="min-w-0">
          <div className="max-w-[280px] truncate text-[12.5px] font-semibold">{fullscreen ? from : title}</div>
          <div className="truncate text-[10.5px] text-white/45">{fullscreen ? title : from}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {!isMobile && (
          <IconButton label="Minimize" tone="onDark" size="sm" onClick={onMinimize}>
            <Minus size={12} strokeWidth={2.4} />
          </IconButton>
        )}
        {!isMobile &&
          (fullscreen ? (
            <IconButton label="Exit full screen" tone="onDark" size="sm" onClick={onRestore}>
              <Square size={11} />
            </IconButton>
          ) : (
            <IconButton label="Full screen" tone="onDark" size="sm" onClick={onFullscreen}>
              <Maximize2 size={12} />
            </IconButton>
          ))}
        <IconButton label="Close" tone="onDark" size="sm" onClick={() => void closeWithSave()}>
          <X size={12} strokeWidth={2.6} />
        </IconButton>
      </div>
    </div>
  );

  const ccBccToggles = (
    <div className="flex gap-2.5 pr-1">
      <button
        type="button"
        onClick={() => setShowCc((v) => !v)}
        className={`text-[11px] font-bold ${showCc ? 'text-muted-foreground' : 'text-primary'}`}
      >
        Cc
      </button>
      <button
        type="button"
        onClick={() => setShowBcc((v) => !v)}
        className={`text-[11px] font-bold ${showBcc ? 'text-muted-foreground' : 'text-primary'}`}
      >
        Bcc
      </button>
    </div>
  );

  const form = (
    <>
      {sendError && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-4 py-2 text-[12.5px] text-destructive">
          {sendError}
        </div>
      )}

      <div className="shrink-0">
        {fromOptions.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
            <span className="w-8 shrink-0 font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">From</span>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Send as"
              className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-foreground outline-none"
            >
              <option value={selfAddress}>
                {selfName ? `${selfName} <${selfAddress}>` : selfAddress}
              </option>
              {fromOptions.map((option) => (
                <option key={option.address} value={option.address}>
                  {option.name ? `${option.name} <${option.address}>` : option.address}
                </option>
              ))}
            </select>
          </div>
        )}

        <WebmailRecipientInput
          label="To"
          value={draft.to}
          onChange={(value) => touch({ to: value })}
          contacts={contacts}
          autoFocus={mode === 'compose' && !resumed?.to}
          placeholder="recipient@domain.com"
          trailing={ccBccToggles}
        />
        {showCc && (
          <WebmailRecipientInput label="Cc" value={draft.cc} onChange={(value) => touch({ cc: value })} contacts={contacts} placeholder="cc@domain.com" />
        )}
        {showBcc && (
          <WebmailRecipientInput label="Bcc" value={draft.bcc} onChange={(value) => touch({ bcc: value })} contacts={contacts} placeholder="bcc@domain.com" />
        )}
        <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
          <span className="w-8 shrink-0 font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Subj</span>
          <input
            type="text"
            value={draft.subject}
            onChange={(e) => touch({ subject: e.target.value })}
            placeholder="Subject"
            aria-label="Subject"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] font-semibold text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      <WebmailEditor
        key={editorSeed}
        initialHtml={editorInitialHtml}
        toolbarPosition="bottom"
        autoFocus={mode !== 'compose' || !!resumed?.to}
        minHeightClass={fullscreen ? 'min-h-[40dvh]' : 'min-h-[180px]'}
        onChange={(html) => touch({ body: html })}
        toolbarExtra={
          onAiWrite ? (
            <Button variant="ghost" size="xs" icon={<Sparkles size={12} />} onClick={() => setShowAi(true)}>
              Write with AI
            </Button>
          ) : undefined
        }
      />

      {attachments.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border bg-pane px-3 py-2">
          {attachments.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted py-1 pl-2 pr-1 text-[12px] text-foreground"
            >
              <Paperclip size={12} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                className="shrink-0 rounded p-0.5 hover:bg-foreground/10"
                title={`Remove ${file.name}`}
                aria-label={`Remove ${file.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <span className="self-center text-[11px] text-muted-foreground">{formatBytes(attachedBytes)} of 25 MB</span>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-pane px-3 py-2.5">
        {/* One surface, two halves: the colour and rounding live on the
            wrapper so it reads as a single button with a divider. */}
        <div
          className={`flex items-stretch rounded-lg bg-primary text-primary-foreground shadow-compose ${
            sendDisabled ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sendDisabled}
            className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-black/10 disabled:cursor-not-allowed ${
              canSchedule ? 'rounded-l-lg' : 'rounded-lg'
            }`}
          >
            {isSending ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Send size={13} strokeWidth={2.4} />
            )}
            {isSending ? (scheduling ? 'Scheduling…' : 'Sending…') : 'Send'}
          </button>
          {canSchedule && <ScheduleSendMenu disabled={sendDisabled} onSchedule={(at) => void handleSend(at)} />}
        </div>

        <IconButton label="Attach files" size="md" onClick={() => fileInputRef.current?.click()}>
          <Paperclip size={14} />
        </IconButton>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {savingDraft ? 'Saving…' : draftSavedAt ? `Draft saved ${formatTime(draftSavedAt)}` : ''}
        </span>

        <IconButton label="Discard" size="md" tone="danger" onClick={() => setConfirmDiscard(true)}>
          <Trash2 size={13} />
        </IconButton>
      </div>
    </>
  );

  const dialogs = (
    <>
      {onAiWrite && (
        <AiWriterModal
          isOpen={showAi}
          onClose={() => setShowAi(false)}
          onGenerate={(prompt) => onAiWrite(prompt, draft.body)}
          onApply={(generated) => {
            // Remount the editor around the generated body: the AI writer
            // replaces the whole document, the one case where reaching past
            // TipTap's own state is right.
            dirtyRef.current = true;
            setSeededHtml(generated + quoted);
            setDraft((prev) => ({ ...prev, body: generated + quoted }));
            setEditorSeed((n) => n + 1);
          }}
        />
      )}
      <ConfirmModal
        isOpen={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={discard}
        icon={<Trash2 size={18} />}
        tone="danger"
        title="Discard this message"
        body="What you have written here will be thrown away, along with any saved draft of it."
        confirmLabel="Discard"
      />
    </>
  );

  // ONE tree for every shape. The fullscreen, windowed and hidden containers
  // differ only in classes and inline style, never in nesting: a different
  // nesting would make React remount the form -- and the editor inside it --
  // on every switch between them, throwing away whatever was being typed.
  // Minimized is `hidden` here (the dock draws the tab), not unmounted.
  return (
    <div
      ref={rootRef}
      data-shortcuts="off"
      // The dock finds the editor through this to hand focus back on restore.
      data-compose-id={model.id}
      role="dialog"
      aria-label={title}
      onFocusCapture={onActivate}
      onPointerDownCapture={onActivate}
      style={
        fullscreen
          ? visible
            ? // Longhands beat inset-0's top and bottom.
              { top: visible.top, height: visible.height, bottom: 'auto' }
            : undefined
          : { right, width, zIndex }
      }
      className={
        hidden
          ? 'hidden'
          : fullscreen
            ? 'fixed inset-0 z-[200] flex animate-fade-in flex-col bg-card'
            : 'fixed bottom-0 flex max-h-[82dvh] animate-rise flex-col overflow-hidden rounded-t-2xl bg-card shadow-window transition-[right] duration-200 ease-out'
      }
    >
      {titleBar}
      <div className={`flex min-h-0 flex-1 flex-col ${fullscreen ? 'mx-auto w-full max-w-[860px] overflow-hidden sm:px-6' : ''}`}>
        {form}
      </div>
      {dialogs}
    </div>
  );
}
