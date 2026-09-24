import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, readAccountStore, withoutAccount, writeAccountStore } from '@/lib/webmail/server';

/** Best-effort revoke upstream; the cookie is rewritten either way. */
async function revoke(token: string): Promise<void> {
  await fetch(`${apiBaseUrl()}/mailbox-auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {
    // A failed backend revoke must not strand the person visibly signed in.
  });
}

/**
 * Sign out.
 *
 * By default only the ACTIVE mailbox: its token is revoked and removed, and
 * the most recently added remaining account takes over -- the caller is told
 * which, so it can reload into it rather than bounce to the login page.
 * `{ all: true }` revokes every account on this browser.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { all?: boolean };
  const store = await readAccountStore();

  if (body.all === true) {
    await Promise.all([
      ...store.accounts.map((a) => revoke(a.token)),
      ...(store.legacyToken ? [revoke(store.legacyToken)] : []),
    ]);
    const response = NextResponse.json({ success: true, data: { remaining: 0, active: null } });
    writeAccountStore(response, { accounts: [], active: null });
    return response;
  }

  const active = store.accounts.find((a) => a.email === store.active);
  if (active) {
    await revoke(active.token);
  } else if (store.legacyToken) {
    await revoke(store.legacyToken);
  }

  const next = active ? withoutAccount(store, active.email) : { accounts: store.accounts, active: store.active };
  const response = NextResponse.json({
    success: true,
    data: { remaining: next.accounts.length, active: next.active },
  });
  writeAccountStore(response, next);
  return response;
}
