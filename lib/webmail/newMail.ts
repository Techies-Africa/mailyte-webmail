import type { ApiMessageSummary } from './adapters';
import type { AccountInbox } from './client';

/**
 * Deciding what counts as NEW mail, apart from how it is announced.
 *
 * The poll returns each signed-in mailbox's newest unread inbox messages.
 * Unread is not new: a message marked unread again, or moved back into the
 * inbox, is unread and old. So a message is announced only when
 *   - its id was not in any earlier answer for that mailbox, and
 *   - it arrived after this page started watching that mailbox.
 * The first answer for a mailbox is only the baseline -- opening the webmail
 * with 40 unread must not fire 40 notifications.
 */

/** Allowance for the mail server's clock running behind this browser's. */
const CLOCK_SLACK_MS = 10 * 60_000;

/** Ids remembered per mailbox. The poll returns five; this only has to outlast them. */
const MAX_REMEMBERED = 200;

export interface WatchState {
  /** When this page started watching the mailbox (browser clock, ms). */
  since: number;
  seen: Set<string>;
}

export interface NewMail {
  account: AccountInbox;
  message: ApiMessageSummary;
}

/** The messages in `accounts` not announced before. Updates `state` in place. */
export function takeNewMail(state: Map<string, WatchState>, accounts: AccountInbox[], now: number): NewMail[] {
  const fresh: NewMail[] = [];
  for (const account of accounts) {
    // A mailbox that could not be asked this time keeps what it had: its
    // next good answer is compared with the last good one.
    if (account.error || account.unread === null) continue;

    const watch = state.get(account.email);
    if (!watch) {
      state.set(account.email, { since: now, seen: new Set(account.latest.map((m) => m.id)) });
      continue;
    }

    for (const message of account.latest) {
      if (watch.seen.has(message.id)) continue;
      watch.seen.add(message.id);
      const arrived = message.received_at ? Date.parse(message.received_at) : NaN;
      if (Number.isFinite(arrived) && arrived < watch.since - CLOCK_SLACK_MS) continue;
      fresh.push({ account, message });
    }

    if (watch.seen.size > MAX_REMEMBERED) {
      watch.seen = new Set([...watch.seen].slice(-MAX_REMEMBERED));
    }
  }
  return fresh;
}

/** Who a message is from, the way a notification names them. */
export function senderOf(message: ApiMessageSummary): string {
  const from = message.from?.[0];
  return from?.name?.trim() || from?.email || 'Someone';
}

export function subjectOf(message: ApiMessageSummary): string {
  return message.subject?.trim() || '(no subject)';
}

// --- The per-device switch -----------------------------------------------------

const PREF_KEY = 'mailyte:new-mail-notifications';

/** 'on' / 'off' as chosen on this device, or null when never asked. */
export type NotifyPref = 'on' | 'off' | null;

export function readNotifyPref(): NotifyPref {
  try {
    const value = window.localStorage.getItem(PREF_KEY);
    return value === 'on' || value === 'off' ? value : null;
  } catch {
    return null;
  }
}

export function storeNotifyPref(value: 'on' | 'off'): void {
  try {
    window.localStorage.setItem(PREF_KEY, value);
  } catch {
    // Private windows can refuse storage; the choice then lasts this visit.
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Whether a desktop notification may be shown right now. */
export function desktopNotificationsOn(): boolean {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  // Granted in the browser but never chosen here counts as on: the person
  // allowed this site to notify them, and this is what it notifies about.
  return readNotifyPref() !== 'off';
}

/**
 * Ask the browser for permission (must run from a click) and remember the
 * answer. Returns the resulting state for the caller to explain.
 */
export async function enableNotifications(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  const permission =
    Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return 'denied';
  storeNotifyPref('on');
  return 'granted';
}
