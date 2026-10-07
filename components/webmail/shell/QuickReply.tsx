'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { AtSign, Maximize2, Send, Trash2 } from 'lucide-react';
import type { ComposeMode, SendResult, WebmailContact, WebmailMessage } from '../types';
import type { ComposePayload } from '../compose/types';
import WebmailEditor from '../WebmailEditor';
import WebmailRecipientInput, { CcBccToggles } from '../WebmailRecipientInput';
import ConfirmModal from '../modals/ConfirmModal';
import Button from '@/components/ui/Button';
import { AttachButton, AttachmentChips, DropOverlay, useAttachments } from '../compose/attachments';
import {
  ccWithMention,
  mentionCandidates,
  mentionEntry,
  mentionTransitions,
  mentionedOnBcc,
  withoutRecipients,
} from '../mentions';
import { quotedBody, replyAllRecipients, replyRecipients, replySubject } from '../composeQuoting';
import { useRevealInView } from './useRevealInView';

/** What "Open in full editor" carries over, so the window starts where the card left off. */
export type QuickReplyDraft = {
  body: string;
  attachments: File[];
  to: string;
  cc: string;
  bcc: string;
};

type QuickReplyProps = {
  message: WebmailMessage;
  mode: 'reply' | 'replyAll';
  selfAddress: string;
  /** Signature HTML to start with, already wrapped by the caller. */
  signatureSeed: string;
  onSend: (payload: ComposePayload, mode: ComposeMode) => Promise<SendResult>;
  onCancel: () => void;
  /** Move what has been typed, attached and addressed into a full compose window. */
  onExpand: (draft: QuickReplyDraft) => void;
  /**
   * Bumped each time the person asks to reply while this card is already
   * open in the same mode. Nothing else about the card changes then, so this
   * is what brings it back into view and the caret back into it.
   */
  revealSignal?: number;
  /** For @mentions; people mentioned here are added to Cc (D2, D7). */
  contacts?: WebmailContact[];
};

/**
 * The inline reply card under a message.
 *
 * Same recipients, subject, threading headers and quotation as the full
 * compose window -- it calls the same helpers -- so a reply written here is
 * indistinguishable on the wire from one written there. The quotation is
 * appended on send rather than shown, which is what an inline reply is for:
 * the original is already on screen above it.
 *
 * Its To, Cc and Bcc are the compose window's own fields (2026-10-07): To
 * filled in, Cc and Bcc behind the same toggles, and a mention adds its
 * person to Cc exactly as it does there.
 *
 * It sits straight under the message, above the earlier conversation
 * (2026-10-07: under a long thread it was a long scroll away). On a long
 * email it still opens below the fold, so it scrolls itself into view once
 * its editor exists (and holds there while the message's images finish
 * loading), and again whenever Reply is asked for while it is already open.
 */
export default function QuickReply({
  message,
  mode,
  selfAddress,
  signatureSeed,
  onSend,
  onCancel,
  onExpand,
  revealSignal,
  contacts = [],
}: QuickReplyProps) {
  // Worked out once: the card remounts for another message or mode.
  const [recipients, setRecipients] = useState(() => {
    const start =
      mode === 'replyAll'
        ? replyAllRecipients(message, selfAddress)
        : { to: replyRecipients(message, selfAddress), cc: '' };
    return { ...start, bcc: '' };
  });
  const [showCc, setShowCc] = useState(() => recipients.cc !== '');
  const [showBcc, setShowBcc] = useState(false);

  // People a mention ADDED to Cc (email -> the Cc entry written), and the
  // mentions last seen in the body -- the compose window's bookkeeping, so
  // deleting a pill takes its person off Cc again and Undo puts them back.
  const mentionAddedRef = useRef(new Map<string, string>());
  const mentionsSeenRef = useRef(new Set<string>());

  const [body, setBody] = useState(signatureSeed);
  const bodyRef = useRef(signatureSeed);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // D1: mentioning someone who is on Bcc names them to everyone, so it is
  // checked before sending, as the compose window does.
  const [bccWarning, setBccWarning] = useState<string[] | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Same picker, drop, limits and chips as the full window; the card's own
  // error bar shows what it rejects.
  const { attachments, attachedBytes, addFiles, removeAt, dragging, dropProps } = useAttachments([], setError);

  const [rootRef, reveal] = useRevealInView<HTMLDivElement>();
  const editorRef = useRef<Editor | null>(null);

  // First open, a switch between Reply and Reply all (the key remounts this
  // card), and the r / a shortcuts all arrive here once the editor exists --
  // the moment the card has its real height.
  const handleReady = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      reveal();
    },
    [reveal],
  );

  // A repeat request with the card already open. The caret goes back where it
  // was, not to the top: they may be halfway through a line. view.focus(),
  // not commands.focus() -- see the Android note in WebmailEditor.
  const seenSignal = useRef(revealSignal);
  useEffect(() => {
    if (revealSignal === seenSignal.current) return;
    seenSignal.current = revealSignal;
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return; // still loading: handleReady reveals
    editor.view.focus();
    reveal();
  }, [revealSignal, reveal]);

  // A dialog's Cancel leaves focus on <body>, where the next letter typed is a
  // page shortcut -- j, k and u leave the message, and this reply with it.
  const refocus = () => {
    const editor = editorRef.current;
    if (editor && !editor.isDestroyed && editor.view.dom.isConnected) editor.view.focus();
  };

  const hasText = body.replace(/<[^>]*>/g, '').trim().length > 0 || /<img\b/i.test(body);
  // Worth a question before it is thrown away: words beyond the signature it
  // opened with, or a file.
  const edited = body !== signatureSeed || attachments.length > 0;

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await onSend(
        {
          to: recipients.to,
          cc: recipients.cc,
          bcc: recipients.bcc,
          subject: replySubject(message.subject),
          body: bodyRef.current + quotedBody(mode, message),
          inReplyTo: message.messageIdHeader ?? undefined,
          references: message.references ?? undefined,
          attachments,
        },
        mode,
      );
      if (!result.success) {
        setError(result.message ?? 'Could not send this reply');
        return;
      }
      onCancel();
    } finally {
      setSending(false);
    }
  };

  const requestSend = () => {
    const exposed = mentionedOnBcc(bodyRef.current, recipients.bcc);
    if (exposed.length > 0) {
      setBccWarning(exposed);
      return;
    }
    void send();
  };

  return (
    // scroll margins: the pane's own padding below the card stays in view when
    // its foot is aligned, and a card taller than the pane stops short of the
    // header when its top is. relative: the drop overlay covers the card. No
    // overflow-hidden: it clipped the address suggestions under To; the footer
    // rounds its own corners instead.
    <div
      ref={rootRef}
      data-shortcuts="off"
      {...dropProps}
      // Escape closes this card (ReadingPane's listener, on window). With
      // something written it asks first, like Discard: stopped here, below
      // window, the close never runs. As there, a key a field has already
      // handled is its own -- except the editor's, which marks every Escape
      // handled -- and keys from this card's dialogs (portals) are theirs.
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !edited) return;
        const target = event.target as HTMLElement;
        if (!event.currentTarget.contains(target)) return;
        if (event.nativeEvent.defaultPrevented && !target.isContentEditable) return;
        event.stopPropagation();
        setConfirmDiscard(true);
      }}
      className="relative animate-fade-in scroll-mb-4 scroll-mt-3 rounded-xl border border-border bg-card shadow-sm sm:scroll-mb-5"
    >
      <WebmailRecipientInput
        label="To"
        value={recipients.to}
        onChange={(to) => setRecipients((prev) => ({ ...prev, to }))}
        contacts={contacts}
        placeholder="recipient@domain.com"
        trailing={
          <CcBccToggles
            showCc={showCc}
            showBcc={showBcc}
            onToggleCc={() => setShowCc((v) => !v)}
            onToggleBcc={() => setShowBcc((v) => !v)}
          />
        }
      />
      {showCc && (
        <WebmailRecipientInput
          label="Cc"
          value={recipients.cc}
          onChange={(cc) => setRecipients((prev) => ({ ...prev, cc }))}
          contacts={contacts}
          placeholder="cc@domain.com"
        />
      )}
      {showBcc && (
        <WebmailRecipientInput
          label="Bcc"
          value={recipients.bcc}
          onChange={(bcc) => setRecipients((prev) => ({ ...prev, bcc }))}
          contacts={contacts}
          placeholder="bcc@domain.com"
        />
      )}

      {error && (
        <div className="border-b border-border bg-destructive/10 px-3.5 py-2 text-[12.5px] text-destructive">{error}</div>
      )}

      <WebmailEditor
        initialHtml={signatureSeed}
        placeholder="Write your reply…"
        compact
        toolbarPosition="bottom"
        onReady={handleReady}
        mentions={{
          contacts: mentionCandidates({ message, recipients, selfAddress, contacts }),
          // D2/D5: onto Cc unless already on To, Cc or Bcc -- and the Cc row
          // opens, so nobody is added where the sender cannot see.
          onMention: (contact) => {
            const email = contact.email.toLowerCase();
            // Already a recipient in their own right: the pill never owns them.
            if (!mentionAddedRef.current.has(email) && ccWithMention(recipients, contact) === null) return;
            mentionAddedRef.current.set(email, mentionEntry(contact));
            // Decided against the LATEST recipients, inside the update: the
            // restore in onChange below may have just put them back.
            setRecipients((prev) => {
              const cc = ccWithMention(prev, contact);
              return cc === null ? prev : { ...prev, cc };
            });
            setShowCc(true);
          },
        }}
        onChange={(html) => {
          bodyRef.current = html;
          setBody(html);
          const { present, removed, restored } = mentionTransitions(mentionsSeenRef.current, html);
          mentionsSeenRef.current = present;
          const added = mentionAddedRef.current;
          const drop = new Set(removed.filter((email) => added.has(email)));
          const back = restored.filter((email) => added.has(email));
          if (drop.size === 0 && back.length === 0) return;
          setRecipients((prev) => {
            let cc = drop.size ? withoutRecipients(prev.cc, drop) : prev.cc;
            for (const email of back) {
              const next = ccWithMention({ ...prev, cc }, { name: null, email });
              if (next !== null) cc = cc ? `${cc}, ${added.get(email)}` : (added.get(email) ?? email);
            }
            return { ...prev, cc };
          });
        }}
      />

      <AttachmentChips files={attachments} totalBytes={attachedBytes} onRemove={removeAt} />

      <div className="flex items-center gap-2 rounded-b-xl border-t border-border bg-pane px-3 py-2">
        {/* A file on its own is a reply worth sending: forwarding a document
            back with nothing to add is normal. */}
        <Button
          variant="primary"
          icon={<Send size={13} />}
          busy={sending}
          disabled={(!hasText && attachments.length === 0) || !recipients.to.trim()}
          onClick={requestSend}
        >
          Send
        </Button>
        <Button variant="ghost" onClick={() => (edited ? setConfirmDiscard(true) : onCancel())} disabled={sending}>
          Discard
        </Button>
        <AttachButton onFiles={addFiles} />
        <span className="flex-1" />
        {/* Words from sm up: at 360px they pushed this past the card's edge. */}
        <Button
          variant="ghost"
          icon={<Maximize2 size={12} />}
          collapseLabel
          onClick={() => onExpand({ body: bodyRef.current, attachments, ...recipients })}
          title="Schedule, or keep writing in a full window"
        >
          Open in full editor
        </Button>
      </div>

      {dragging && <DropOverlay />}

      <ConfirmModal
        isOpen={!!bccWarning}
        onClose={() => {
          setBccWarning(null);
          refocus();
        }}
        onConfirm={() => {
          setBccWarning(null);
          void send();
        }}
        icon={<AtSign size={18} />}
        title="You mentioned someone on Bcc"
        body={`${bccWarning?.join(', ') ?? ''} ${
          (bccWarning?.length ?? 0) === 1 ? 'is' : 'are'
        } on Bcc but mentioned in the message, so everyone who receives it will see they were included.`}
        confirmLabel="Send anyway"
      />
      <ConfirmModal
        isOpen={confirmDiscard}
        onClose={() => {
          setConfirmDiscard(false);
          refocus();
        }}
        onConfirm={onCancel}
        icon={<Trash2 size={18} />}
        tone="danger"
        title="Discard this reply"
        body="What you have written here will be thrown away, along with any files attached to it."
        confirmLabel="Discard"
      />
    </div>
  );
}
