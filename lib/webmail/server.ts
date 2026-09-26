import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

/**
 * Where the mail server lives.
 *
 * Read at request time, on the server, and deliberately NOT a `NEXT_PUBLIC_`
 * variable: that is what makes one published image usable by everyone. Set
 * MAILBOX_API_BASE_URL and restart, no rebuild.
 */
export function apiBaseUrl(): string {
  const url =
    process.env.MAILBOX_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'http://localhost:8080/api/v1';
  return url.replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Sessions
//
// The browser's own JS never holds a token: every mailbox call goes browser ->
// a route handler here (cookie read server-side) -> the mail server with the
// Bearer header attached. That is the whole reason the proxy exists.
//
// Several mailboxes can be signed in at once. The proxy keeps ONE HttpOnly
// cookie holding every account's token and which one is active; the page only
// ever learns the addresses. Switching is a pointer change, so a person with a
// personal and a shared-team mailbox moves between them without typing a
// password twice.
// ---------------------------------------------------------------------------

/** The pre-multi-account cookie. Still honoured, migrated on first sight. */
export const MAILBOX_COOKIE_NAME = 'mailyte_mailbox_token';

export const ACCOUNTS_COOKIE_NAME = 'mailyte_mailbox_accounts';

/** Cookie budget: five tokens fit in well under 4 KB. */
export const MAX_ACCOUNTS = 5;

export interface StoredAccount {
  email: string;
  token: string;
  /** ISO instant. Pruned on read once it has passed. */
  expires_at: string;
}

export interface AccountStore {
  accounts: StoredAccount[];
  /** The address whose token mailbox calls use. */
  active: string | null;
}

function decode(raw: string | undefined): AccountStore {
  if (!raw) return { accounts: [], active: null };
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<AccountStore>;
    const now = Date.now();
    const accounts = (Array.isArray(parsed.accounts) ? parsed.accounts : []).filter(
      (a): a is StoredAccount =>
        !!a &&
        typeof a.email === 'string' &&
        typeof a.token === 'string' &&
        typeof a.expires_at === 'string' &&
        new Date(a.expires_at).getTime() > now,
    );
    const active =
      typeof parsed.active === 'string' && accounts.some((a) => a.email === parsed.active)
        ? parsed.active
        : (accounts[accounts.length - 1]?.email ?? null);
    return { accounts, active };
  } catch {
    return { accounts: [], active: null };
  }
}

/**
 * The address the accounts cookie makes active, or null when it names none
 * (no cookie, or only the pre-multi-account one). Pure, so the request proxy
 * (proxy.ts) can use it without the request-scoped cookie helpers.
 */
export function activeAccountOf(raw: string | undefined): string | null {
  return decode(raw).active;
}

function encode(store: AccountStore): string {
  return Buffer.from(JSON.stringify(store)).toString('base64url');
}

/** Every signed-in account, plus the legacy single-session cookie if present. */
export async function readAccountStore(): Promise<AccountStore & { legacyToken: string | null }> {
  const jar = await cookies();
  const store = decode(jar.get(ACCOUNTS_COOKIE_NAME)?.value);
  return { ...store, legacyToken: jar.get(MAILBOX_COOKIE_NAME)?.value ?? null };
}

/** The token mailbox calls should carry: the active account's, else the legacy one. */
export async function mailboxToken(): Promise<string | null> {
  const store = await readAccountStore();
  const active = store.accounts.find((a) => a.email === store.active);
  return active?.token ?? store.legacyToken;
}

/**
 * Persist the store on a response. An empty store deletes the cookie. The
 * legacy cookie is always removed here: once the new cookie exists it is the
 * only source of truth, and a stale single-session cookie beside it would
 * resurrect a signed-out mailbox.
 */
export function writeAccountStore(response: NextResponse, store: AccountStore): void {
  response.cookies.delete(MAILBOX_COOKIE_NAME);

  if (store.accounts.length === 0) {
    response.cookies.delete(ACCOUNTS_COOKIE_NAME);
    return;
  }

  const latest = store.accounts.reduce(
    (max, a) => Math.max(max, new Date(a.expires_at).getTime()),
    0,
  );

  response.cookies.set(ACCOUNTS_COOKIE_NAME, encode(store), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(latest),
  });
}

/** Add or replace one account and make it active; the oldest falls off past the cap. */
export function withAccount(store: AccountStore, account: StoredAccount): AccountStore {
  const email = account.email.trim().toLowerCase();
  const others = store.accounts.filter((a) => a.email !== email);
  const accounts = [...others, { ...account, email }].slice(-MAX_ACCOUNTS);
  return { accounts, active: email };
}

export function withoutAccount(store: AccountStore, email: string): AccountStore {
  const accounts = store.accounts.filter((a) => a.email !== email);
  const active =
    store.active === email ? (accounts[accounts.length - 1]?.email ?? null) : store.active;
  return { accounts, active };
}
