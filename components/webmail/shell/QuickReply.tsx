'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Maximize2, Send, X } from 'lucide-react';
import type { ComposeMode, SendResult, WebmailContact, WebmailMessage } from '../types';
import type { ComposePayload } from '../compose/types';
import WebmailEditor from '../WebmailEditor';
import Button from '@/components/ui/Button';
import { AttachButton, AttachmentChips, useAttachments } from '../compose/attachments';
import { ccWithMention } from '../mentions';
import { quotedBody, replyAllRecipients, replyRecipients, replySubject } from '../composeQuoting';
import { useRevealInView } from './useRevealInView';

type QuickReplyProps = {
  message: WebmailMessage;
  mode: 'reply' | 'replyAll';
  selfAddress: string;
  /** Signature HTML to start with, already wrapped by the caller. */
  signatureSeed: string;
  onSend: (payload: ComposePayload, mode: ComposeMode) => Promise<SendResult>;
  onCancel: () => void;
  /** Move what has been typed, and any files attached, into a full compose window. */
  onExpand: (body: string, attachments: File[]) => void;
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
 * It opens at the very end of the message and the conversation below it, so
 * on a long email it used to open off-screen and Reply looked dead. It now
 * scrolls itself into view once its editor exists (and holds there while the
 * message's images finish loading), and again whenever Reply is asked for
 * while it is already open.
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
  const recipients = useMemo(() => {
    if (mode === 'replyAll') return replyAllRecipients(message, selfAddress);
    return { to: replyRecipients(message), cc: '' };
  }, [message, mode, selfAddress]);

  // People an @mention added (D7). The card's recipients are otherwise
  // fixed, so these are kept apart, shown on the Cc line, and each can be
  // taken off again with its ×.
  const [mentionCc, setMentionCc] = useState<string[]>([]);
  const cc = [recipients.cc, ...mentionCc].filter(Boolean).join(', ');

  const [body, setBody] = useState(signatureSeed);
  const bodyRef = useRef(signatureSeed);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same picker, limits and chips as the full window; the card's own error
  // bar shows what it rejects.
  const { attachments, attachedBytes, addFiles, removeAt } = useAttachments([], setError);

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

  const hasText = body.replace(/<[^>]*>/g, '').trim().length > 0 || /<img\b/i.test(body);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await onSend(
        {
          to: recipients.to,
          cc,
          bcc: '',
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

  return (
    // scroll margins: the pane's own padding below the card stays in view when
    // its foot is aligned, and a card taller than the pane stops short of the
    // header when its top is.
    <div
      ref={rootRef}
      data-shortcuts="off"
      className="animate-fade-in scroll-mb-4 scroll-mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:scroll-mb-5"
    >
      <div className="flex items-start gap-2 border-b border-border/70 px-3.5 py-2.5">
        <span className="w-6 shrink-0 pt-px font-mono text-[11px] font-medium uppercase text-muted-foreground">To</span>
        <div className="min-w-0 flex-1 text-[13px]">
          <div className="truncate font-semibold">{recipients.to}</div>
          {recipients.cc && (
            <div className="truncate text-[12px] text-muted-foreground">
              <span className="font-mono text-[10.5px] uppercase">Cc</span> {recipients.cc}
            </div>
          )}
          {mentionCc.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
              <span className="font-mono text-[10.5px] uppercase">{recipients.cc ? '+Cc' : 'Cc'}</span>
              {mentionCc.map((entry) => (
                <span key={entry} className="inline-flex items-center gap-0.5 rounded bg-muted py-px pl-1.5 pr-0.5 text-foreground">
                  {entry}
                  <button
                    type="button"
                    onClick={() => setMentionCc((prev) => prev.filter((e) => e !== entry))}
                    className="rounded p-0.5 hover:bg-foreground/10"
                    aria-label={`Remove ${entry} from Cc`}
                    title="Remove from Cc"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

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
          contacts,
          onMention: (contact) => {
            const next = ccWithMention({ to: recipients.to, cc, bcc: '' }, contact);
            if (next === null) return;
            const entry = contact.name?.trim() ? `${contact.name.trim()} <${contact.email}>` : contact.email;
            setMentionCc((prev) => [...prev, entry]);
          },
        }}
        onChange={(html) => {
          bodyRef.current = html;
          setBody(html);
        }}
      />

      <AttachmentChips files={attachments} totalBytes={attachedBytes} onRemove={removeAt} />

      <div className="flex items-center gap-2 border-t border-border bg-pane px-3 py-2">
        {/* A file on its own is a reply worth sending: forwarding a document
            back with nothing to add is normal. */}
        <Button
          variant="primary"
          icon={<Send size={13} />}
          busy={sending}
          disabled={!hasText && attachments.length === 0}
          onClick={() => void send()}
        >
          Send
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={sending}>
          Discard
        </Button>
        <AttachButton onFiles={addFiles} />
        <span className="flex-1" />
        {/* Words from sm up: at 360px they pushed this past the card's edge. */}
        <Button
          variant="ghost"
          icon={<Maximize2 size={12} />}
          collapseLabel
          onClick={() => onExpand(bodyRef.current, attachments)}
          title="Change recipients or schedule"
        >
          Open in full editor
        </Button>
      </div>
    </div>
  );
}
