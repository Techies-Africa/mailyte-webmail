'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/Toast';
import type { ApiMessageSummary } from './adapters';
import { listAccountInboxes, switchAccount, type AccountInbox } from './client';
import {
  desktopNotificationsOn,
  enableNotifications,
  notificationsSupported,
  readNotifyPref,
  senderOf,
  storeNotifyPref,
  subjectOf,
  takeNewMail,
  type NewMail,
  type WatchState,
} from './newMail';
import { unwrap } from './query/errors';
import { qk } from './query/keys';

/**
 * How often every signed-in mailbox is asked for new mail. Kept running while
 * the tab is in the background -- that is when a notification is worth
 * having. Browsers slow hidden tabs' timers to about once a minute anyway.
 */
export const NEW_MAIL_POLL_MS = 60_000;

/** More than this many at once from one mailbox become a single "N new" notice. */
const MAX_SEPARATE = 3;

/** Asked once, a little after the inbox has settled, never on top of sign-in. */
const PROMPT_DELAY_MS = 8_000;

const NO_UNREAD: Record<string, number | null> = {};

/**
 * Tells the person when mail arrives in ANY mailbox signed in on this
 * browser, not only the one on screen.
 *
 * Tab hidden: a desktop notification, if the browser allows them. Tab in
 * view: a toast. Clicking either opens the message -- in place when it is
 * for the mailbox on screen, otherwise after switching to its mailbox.
 *
 * Works while a Mailyte tab is open, in the background included. Nothing
 * reaches a closed browser: that needs Web Push, which this is not.
 */
export function useNewMailNotifier({
  currentEmail,
  onOpenHere,
}: {
  /** The mailbox this page shows. */
  currentEmail: string;
  /** Open one of its messages without leaving the page; null = its inbox. */
  onOpenHere: (message: ApiMessageSummary | null) => void;
}) {
  const { toast } = useToast();

  const query = useQuery({
    queryKey: qk.accountInboxes,
    queryFn: async () => unwrap(await listAccountInboxes())?.accounts ?? [],
    refetchInterval: NEW_MAIL_POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 20_000,
    retry: false,
  });

  const watch = useRef(new Map<string, WatchState>());
  // Callers pass fresh closures each render; the announcer reads the latest.
  const latest = useRef({ currentEmail, onOpenHere, toast });
  useEffect(() => {
    latest.current = { currentEmail, onOpenHere, toast };
  });

  useEffect(() => {
    const accounts = query.data;
    if (!accounts) return;
    const fresh = takeNewMail(watch.current, accounts, Date.now());
    if (fresh.length > 0) announce(fresh, accounts.length > 1, latest.current);
  }, [query.data]);

  // The one-time question. Only when the browser has never been asked and
  // nobody has said no here; Settings > Notifications is the way back in.
  useEffect(() => {
    if (!notificationsSupported() || Notification.permission !== 'default' || readNotifyPref() !== null) return;
    const timer = window.setTimeout(() => {
      latest.current.toast('Get a desktop notification when new mail arrives?', {
        tone: 'info',
        duration: 0,
        action: {
          label: 'Turn on',
          onClick: () => {
            void enableNotifications().then((result) => {
              if (result === 'denied') {
                latest.current.toast('Notifications are blocked for this site in your browser settings.', {
                  tone: 'warning',
                });
              }
            });
          },
        },
        onClose: (reason) => {
          if (reason === 'dismissed') storeNotifyPref('off');
        },
      });
    }, PROMPT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const unreadByAccount = useMemo(
    () =>
      query.data
        ? Object.fromEntries(query.data.map((account) => [account.email, account.unread]))
        : NO_UNREAD,
    [query.data],
  );

  return { unreadByAccount };
}

interface Announcer {
  currentEmail: string;
  onOpenHere: (message: ApiMessageSummary | null) => void;
  toast: ReturnType<typeof useToast>['toast'];
}

function announce(fresh: NewMail[], severalAccounts: boolean, ctx: Announcer) {
  const here = ctx.currentEmail.toLowerCase();
  const isHere = (account: AccountInbox) => account.email === here;

  const open = (account: AccountInbox, message: ApiMessageSummary | null) => {
    if (isHere(account)) {
      ctx.onOpenHere(message);
      return;
    }
    const landing = message ? `/?folder=INBOX&id=${encodeURIComponent(message.id)}` : '/';
    void switchAccount(account.email, landing);
  };

  const byAccount = new Map<string, NewMail[]>();
  for (const item of fresh) {
    byAccount.set(item.account.email, [...(byAccount.get(item.account.email) ?? []), item]);
  }

  if (document.visibilityState === 'hidden' && desktopNotificationsOn()) {
    for (const items of byAccount.values()) {
      const { account } = items[0];
      const where = severalAccounts ? account.email : null;
      if (items.length > MAX_SEPARATE) {
        notify(`${items.length} new emails`, where ?? 'In your inbox', `${account.email}:batch`, () => open(account, null));
        continue;
      }
      for (const { message } of items) {
        const body = where ? `${subjectOf(message)}\n${where}` : subjectOf(message);
        notify(senderOf(message), body, `${account.email}:${message.id}`, () => open(account, message));
      }
    }
    return;
  }

  // In view (or desktop notifications off): one toast, the latest arrival.
  // The toast area holds one message at a time, so several arrivals are
  // counted rather than queued.
  if (document.visibilityState !== 'visible') return;
  const { account, message } = fresh[0];
  const elsewhere = isHere(account) ? '' : ` for ${account.email}`;
  const text =
    fresh.length === 1
      ? `New email${elsewhere} from ${senderOf(message)}: ${subjectOf(message)}`
      : byAccount.size === 1
        ? `${fresh.length} new emails${elsewhere}`
        : `${fresh.length} new emails across ${byAccount.size} accounts`;
  ctx.toast(text, {
    tone: 'info',
    duration: 8_000,
    action: {
      label: isHere(account) ? 'Open' : 'Switch',
      onClick: () => open(account, fresh.length === 1 ? message : null),
    },
  });
}

function notify(title: string, body: string, tag: string, onClick: () => void) {
  try {
    // The tag is per message, so two open tabs announcing the same arrival
    // show one notification, the second quietly replacing the first.
    const notification = new Notification(title, { body, tag, icon: '/logo-192.png' });
    notification.onclick = () => {
      window.focus();
      notification.close();
      onClick();
    };
  } catch {
    // Some mobile browsers expose Notification but only allow it from a
    // service worker; there, the toast on return is the notice.
  }
}
