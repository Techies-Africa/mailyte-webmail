import { cookies } from 'next/headers';

// A deliberately separate cookie from any host application's own session --
// a mailbox holder is a different credential tier from an administrator, and
// the two must never share a cookie or be readable interchangeably.
export const MAILBOX_COOKIE_NAME = 'mailyte_mailbox_token';

/**
 * Where the mail server lives.
 *
 * **Read at request time, on the server, and deliberately NOT a
 * `NEXT_PUBLIC_` variable.** Next.js inlines `NEXT_PUBLIC_*` into the bundle
 * at build time, which would bake one deployment's hostname into the image --
 * and a self-hoster's mail server address is not knowable when the image is
 * built. Every call here is made by a route handler, server-side, so the
 * value can simply be read from the environment when the request arrives.
 *
 * That is what makes one published image usable by everyone: set
 * MAILBOX_API_BASE_URL and restart, no rebuild.
 */
export function apiBaseUrl(): string {
  const url =
    process.env.MAILBOX_API_BASE_URL ||
    // Accepted as a fallback so an existing deployment that already sets the
    // old name keeps working; new deployments should use MAILBOX_API_BASE_URL.
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'http://localhost:8080/api/v1';
  return url.replace(/\/$/, '');
}

/**
 * The browser's own JS never holds this token (HttpOnly cookie) -- every
 * webmail API call goes browser -> this Next.js route (cookie read
 * server-side) -> the mail server with the Bearer header attached. The token
 * is therefore never reachable from script, which is the whole point of the
 * proxy sitting here rather than the browser calling the mail server itself.
 */
export async function mailboxToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(MAILBOX_COOKIE_NAME)?.value ?? null;
}
