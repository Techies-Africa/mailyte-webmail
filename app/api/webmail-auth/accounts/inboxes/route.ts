import { NextResponse } from 'next/server';
import type { ApiMessageSummary } from '@/lib/webmail/adapters';
import type { AccountInbox } from '@/lib/webmail/client';
import { apiBaseUrl, readAccountStore, type StoredAccount } from '@/lib/webmail/server';

/** Newest unread inbox messages returned per account: enough to name what just arrived. */
const LATEST = 5;

/** One slow mailbox must not hold up the others' notifications. */
const TIMEOUT_MS = 15_000;

async function inboxOf(account: StoredAccount, active: boolean): Promise<AccountInbox> {
  const base = { email: account.email, active, unread: null, latest: [] };
  const res = await fetch(`${apiBaseUrl()}/mailbox/messages?folder=INBOX&unread=true&limit=${LATEST}`, {
    headers: { Authorization: `Bearer ${account.token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res) return { ...base, error: 'unavailable' };
  // 403 is a session that must change its password first: signed in, but
  // allowed nothing else until then. Neither can be read, and neither is an outage.
  if (res.status === 401 || res.status === 403) return { ...base, error: 'signed_out' };

  const body = (await res.json().catch(() => null)) as {
    data?: { messages?: ApiMessageSummary[]; total?: number };
  } | null;
  if (!res.ok || !body?.data) return { ...base, error: 'unavailable' };

  return { ...base, unread: body.data.total ?? 0, latest: body.data.messages ?? [] };
}

/**
 * What is new in the inbox of EVERY mailbox signed in on this browser.
 *
 * The new-mail notifier polls this. It lives beside the account list rather
 * than under /api/webmail/, which the request proxy pins to the ACTIVE
 * mailbox: this is the one call that is about all of them, so a message to
 * a mailbox you are not looking at can still be announced.
 *
 * Unread INBOX only -- mail the server's rules filed into Promotions, Social
 * or Junk does not interrupt anyone, the same line Gmail draws. Addresses and
 * message headers only; tokens never leave this handler.
 */
export async function GET() {
  const store = await readAccountStore();
  const accounts = await Promise.all(
    store.accounts.map((account) => inboxOf(account, account.email === store.active)),
  );
  return NextResponse.json({ success: true, data: { accounts } });
}
