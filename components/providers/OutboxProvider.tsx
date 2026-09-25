'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ComposeMode, WebmailMessage } from '@/components/webmail/types';
import type { ComposePayload } from '@/components/webmail/compose/types';
import { useToast } from '@/components/ui/Toast';
import WebmailUndoToast from '@/components/webmail/WebmailUndoToast';
import type { ApiSettings } from '@/lib/webmail/adapters';
import { splitAddresses } from '@/lib/webmail/addresses';
import { sendMessage as apiSend } from '@/lib/webmail/client';
import { formatSendAt } from '@/lib/webmail/scheduleTimes';
import { qk } from '@/lib/webmail/query/keys';
import { invalidateFolderLists } from '@/lib/webmail/query/messageCache';
import { discardDraftNow, folderNameByRole, loadScheduled, refreshFolders } from '@/lib/webmail/query/removals';
import {
  addBeforeSessionChange,
  addSessionDropHandler,
  trackSessionWork,
  useUnauthorizedHandler,
} from '@/lib/webmail/query/session';

/**
 * The outbox: a message in its undo-send window, held for the whole app.
 *
 * Undo send is a client-side hold, not a server-side recall: the message has
 * simply not been handed to the server yet. It used to live in the inbox, so
 * moving to Settings or Calendar meant sending it at once with no way back.
 * Held here, above every page, the countdown and its Undo follow the person
 * anywhere; Undo from another page comes back to the inbox with the message
 * open again, exactly as it was -- attachments included, since the trip back
 * is a client-side navigation and the files are still in memory.
 */

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

export interface HeldMessage {
  payload: ComposePayload;
  context: SendContext;
}

/** How the inbox puts a message back into a compose window. */
export type ComposeOpener = (held: HeldMessage) => void;

interface Outbox {
  /** Send, or hold for the undo window when that preference is on. */
  send: (payload: ComposePayload, context: SendContext) => Promise<{ success: true }>;
  /** Registered by the inbox while it is on screen. Returns the unregister. */
  registerComposeOpener: (opener: ComposeOpener) => () => void;
}

/** Fallback window when the preference has not loaded yet. */
const DEFAULT_UNDO_SECONDS = 5;

/** Pages with no mailbox to return to. */
const NO_TOAST_PATHS = new Set(['/login', '/change-password']);

const OutboxContext = createContext<Outbox | null>(null);

export function useOutbox(): Outbox {
  const outbox = useContext(OutboxContext);
  if (!outbox) throw new Error('useOutbox must be used inside OutboxProvider');
  return outbox;
}

export default function OutboxProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const onUnauthorized = useUnauthorizedHandler();

  const [pending, setPending] = useState<PendingSend | null>(null);
  // The message in the undo window, readable from the timer that sends it.
  const heldRef = useRef<HeldMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openerRef = useRef<ComposeOpener | null>(null);
  // A message to put back once the inbox is on screen to take it.
  const queuedRef = useRef<HeldMessage | null>(null);

  /** Back into a compose window: here if the inbox is showing, else after going there. */
  const reopen = useCallback(
    (held: HeldMessage) => {
      const opener = openerRef.current;
      if (opener) {
        opener(held);
        return;
      }
      queuedRef.current = held;
      router.push('/');
    },
    [router],
  );

  const deliver = useCallback(
    async (payload: ComposePayload, context: SendContext) => {
      // Tracked: a switch or sign-out waits for it rather than cutting it off.
      const result = await trackSessionWork(
        apiSend(
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
          onUnauthorized,
        ),
      );

      if (!result.success) {
        const verb = payload.sendAt ? 'was not scheduled' : 'was not sent';
        toast(`"${payload.subject || '(no subject)'}" ${verb}: ${result.message}`, {
          tone: 'error',
          // Its draft is still in Drafts; Reopen brings back the rest as well.
          action: { label: 'Reopen', onClick: () => reopen({ payload, context }) },
        });
        return;
      }

      // It has gone: the draft it was saved as is not a draft any more.
      const draftId = payload.draftId ?? context.draftId;
      if (draftId) discardDraftNow(queryClient, draftId, onUnauthorized, toast);
      void refreshFolders(queryClient);

      if (payload.sendAt) {
        toast(`Scheduled to send ${formatSendAt(new Date(payload.sendAt))}`);
        void queryClient.invalidateQueries({ queryKey: qk.lists });
        void loadScheduled(queryClient);
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
      // Sent gains a copy, and a reply changes the conversation it answered.
      void invalidateFolderLists(queryClient, [folderNameByRole(queryClient, 'sent', 'Sent')]);
      void queryClient.invalidateQueries({ queryKey: qk.threads });
    },
    [onUnauthorized, toast, reopen, queryClient],
  );

  /** Take the held message out of its window, without sending it. */
  const take = useCallback((): HeldMessage | null => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const held = heldRef.current;
    heldRef.current = null;
    setPending(null);
    return held;
  }, []);

  const send = useCallback(
    async (payload: ComposePayload, sendContext: SendContext) => {
      const context = { ...sendContext, draftId: payload.draftId ?? sendContext.draftId };
      // The preference, from the cached settings (raw, as the server sent them).
      const settings = queryClient.getQueryData<ApiSettings>(qk.settings);
      // A scheduled message skips the hold; it can be called back from the
      // Scheduled folder for the whole of the wait.
      if (payload.sendAt || !settings?.undo_send_enabled) {
        void deliver(payload, context);
        return { success: true as const };
      }

      // A second message inside the first one's window: the first goes now.
      const earlier = take();
      if (earlier) void deliver(earlier.payload, earlier.context);

      const windowMs = (settings.undo_send_seconds || DEFAULT_UNDO_SECONDS) * 1000;
      heldRef.current = { payload, context };
      timerRef.current = setTimeout(() => {
        const held = take();
        if (held) void deliver(held.payload, held.context);
      }, windowMs);
      setPending({ subject: payload.subject || '(no subject)', until: Date.now() + windowMs, payload, context });
      return { success: true as const };
    },
    [queryClient, deliver, take],
  );

  /** Undo: nothing was sent; the message goes back in front of the person. */
  const undo = useCallback(() => {
    const held = take();
    if (held) reopen(held);
  }, [take, reopen]);

  const registerComposeOpener = useCallback((opener: ComposeOpener) => {
    openerRef.current = opener;
    const queued = queuedRef.current;
    queuedRef.current = null;
    if (queued) opener(queued);
    return () => {
      if (openerRef.current === opener) openerRef.current = null;
    };
  }, []);

  // The held message belongs to this session. Switching or signing out here
  // sends it first, while it is still this mailbox's to send; a session
  // changed elsewhere drops it (its draft stays in Drafts).
  const deliverRef = useRef(deliver);
  useEffect(() => {
    deliverRef.current = deliver;
  }, [deliver]);
  useEffect(
    () =>
      addBeforeSessionChange(async () => {
        const held = take();
        if (held) await deliverRef.current(held.payload, held.context);
      }),
    [take],
  );
  useEffect(
    () =>
      addSessionDropHandler(() => {
        take();
        queuedRef.current = null;
      }),
    [take],
  );

  // Closing the tab inside the undo window would lose the message: ask first.
  useEffect(() => {
    if (!pending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pending]);

  const api = useMemo(() => ({ send, registerComposeOpener }), [send, registerComposeOpener]);

  return (
    <OutboxContext.Provider value={api}>
      {children}
      {pending && !NO_TOAST_PATHS.has(pathname) && (
        <WebmailUndoToast
          // A second send inside the window is a new countdown, not the old one's remainder.
          key={pending.until}
          subject={pending.subject}
          until={pending.until}
          onUndo={undo}
        />
      )}
    </OutboxContext.Provider>
  );
}
