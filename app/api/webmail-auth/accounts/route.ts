import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, readAccountStore, writeAccountStore, type AccountStore } from '@/lib/webmail/server';

/** How long a migrated legacy session is kept before it is pruned locally. The server still decides when it really expires. */
const LEGACY_GRACE_MS = 7 * 24 * 3600 * 1000;

function summary(store: AccountStore, ended: string[] = []) {
  return {
    accounts: store.accounts.map((a) => ({
      email: a.email,
      active: a.email === store.active,
      expires_at: a.expires_at,
    })),
    /** Mailboxes just dropped because the mail server has ended their session. */
    ended,
  };
}

/**
 * Whether the mail server has ended this session. Only a definite 401 counts:
 * an unreachable server or a 403 (a password change pending) is not "signed
 * out", and dropping the account over it would sign someone out for nothing.
 */
async function sessionEnded(token: string): Promise<boolean> {
  const res = await fetch(`${apiBaseUrl()}/mailbox/capabilities`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null);
  return res?.status === 401;
}

/**
 * The store without the accounts whose sessions have ended. The cookie keeps
 * a token until its own expiry, but the mail server ends a session after
 * eight idle hours -- so "Continue as" offered mailboxes that could no longer
 * open, and a click on one went to the inbox, was refused, and landed back
 * here with the same row still offered (2026-09-30).
 */
async function withoutEnded(store: AccountStore): Promise<{ next: AccountStore; ended: string[] }> {
  const verdicts = await Promise.all(store.accounts.map((a) => sessionEnded(a.token)));
  const ended = store.accounts.filter((_, i) => verdicts[i]).map((a) => a.email);
  if (ended.length === 0) return { next: store, ended };
  const accounts = store.accounts.filter((a) => !ended.includes(a.email));
  // No stand-in is made active: this is the sign-in page, and which mailbox
  // to open is the person's choice.
  const active = store.active && !ended.includes(store.active) ? store.active : null;
  return { next: { accounts, active }, ended };
}

/**
 * The mailboxes signed in on this browser, and which one is active.
 *
 * Addresses only -- never tokens. Answers 200 with an empty list when nobody
 * is signed in, so the login page can ask without being bounced.
 *
 * A browser still carrying the old single-session cookie is migrated here:
 * the proxy asks the mail server whose token it is and files it as the one
 * account, so an upgrade never signs anybody out.
 */
export async function GET(request: NextRequest) {
  const store = await readAccountStore();

  // `?check=1` (the sign-in page): ask the mail server about every session
  // and offer only the ones that still open. Not on every call -- the rail's
  // account menu reads this list on each page load.
  if (request.nextUrl.searchParams.get('check') === '1' && store.accounts.length > 0) {
    const { next, ended } = await withoutEnded(store);
    const response = NextResponse.json({ success: true, data: summary(next, ended) });
    if (ended.length > 0) writeAccountStore(response, next);
    return response;
  }

  if (store.accounts.length === 0 && store.legacyToken) {
    const res = await fetch(`${apiBaseUrl()}/mailbox/capabilities`, {
      headers: { Authorization: `Bearer ${store.legacyToken}` },
      cache: 'no-store',
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    const email: string | undefined = data?.data?.email_address;

    if (res?.ok && email) {
      const migrated: AccountStore = {
        accounts: [
          {
            email: email.toLowerCase(),
            token: store.legacyToken,
            expires_at: new Date(Date.now() + LEGACY_GRACE_MS).toISOString(),
          },
        ],
        active: email.toLowerCase(),
      };
      const response = NextResponse.json({ success: true, data: summary(migrated) });
      writeAccountStore(response, migrated);
      return response;
    }
  }

  return NextResponse.json({ success: true, data: summary(store) });
}

/** Make another signed-in mailbox the active one. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  const store = await readAccountStore();

  const target = store.accounts.find((a) => a.email === email);
  if (!target) {
    return NextResponse.json(
      { success: false, message: 'That mailbox is not signed in on this browser' },
      { status: 404 },
    );
  }

  // Switching to a session the mail server has ended would load the inbox,
  // be refused, and bounce to the sign-in page with no word of why. Say so
  // here instead, and forget the dead token. 410, not 401: the client treats
  // a 401 as "this page's own session is gone" and never reads the message.
  if (await sessionEnded(target.token)) {
    const remaining: AccountStore = {
      accounts: store.accounts.filter((a) => a.email !== email),
      active: store.active === email ? null : store.active,
    };
    const response = NextResponse.json(
      {
        success: false,
        error_code: 'session_ended',
        message: `You were signed out of ${email}. Enter your password to open it again.`,
        data: summary(remaining, [email]),
      },
      { status: 410 },
    );
    writeAccountStore(response, remaining);
    return response;
  }

  const next: AccountStore = { accounts: store.accounts, active: email };
  const response = NextResponse.json({ success: true, data: summary(next) });
  writeAccountStore(response, next);
  return response;
}
