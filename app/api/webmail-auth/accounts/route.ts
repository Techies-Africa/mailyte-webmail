import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, readAccountStore, writeAccountStore, type AccountStore } from '@/lib/webmail/server';

/** How long a migrated legacy session is kept before it is pruned locally. The server still decides when it really expires. */
const LEGACY_GRACE_MS = 7 * 24 * 3600 * 1000;

function summary(store: AccountStore) {
  return {
    accounts: store.accounts.map((a) => ({
      email: a.email,
      active: a.email === store.active,
      expires_at: a.expires_at,
    })),
  };
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
export async function GET() {
  const store = await readAccountStore();

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

  if (!store.accounts.some((a) => a.email === email)) {
    return NextResponse.json(
      { success: false, message: 'That mailbox is not signed in on this browser' },
      { status: 404 },
    );
  }

  const next: AccountStore = { accounts: store.accounts, active: email };
  const response = NextResponse.json({ success: true, data: summary(next) });
  writeAccountStore(response, next);
  return response;
}
