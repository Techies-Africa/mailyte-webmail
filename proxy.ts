import { NextResponse, type NextRequest } from 'next/server';
import { ACCOUNTS_COOKIE_NAME, activeAccountOf } from '@/lib/webmail/server';

/** Must match ACCOUNT_HEADER in lib/webmail/query/session.ts. */
const ACCOUNT_HEADER = 'x-mailbox-account';

/**
 * Every mailbox request is refused unless it is for the mailbox this
 * browser's session cookie currently makes active.
 *
 * A message id is FOLDER:UID and says nothing about whose mailbox it is in;
 * the route handlers take that from the cookie. The cookie is shared by
 * every tab and changes when any of them switches account or signs out --
 * or when the active account's token expires and the next one takes over. A
 * request a tab queued for one mailbox (an archive, a delete, a draft save)
 * could otherwise land on the same ids in another. So the page names the
 * account it belongs to, and a mismatch is refused here, before any route
 * runs. Requests that name no account (a fresh page before it has asked, the
 * sign-in routes, plain links) pass: they carry nothing stale.
 */
export function proxy(request: NextRequest) {
  const expected = request.headers.get(ACCOUNT_HEADER)?.trim().toLowerCase();
  if (!expected) return NextResponse.next();

  const active = activeAccountOf(request.cookies.get(ACCOUNTS_COOKIE_NAME)?.value);
  if (active && active !== expected) {
    return NextResponse.json(
      {
        success: false,
        message: 'This tab belongs to another mailbox now. Reload to continue.',
        error_code: 'account_mismatch',
      },
      { status: 409 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/webmail/:path*'],
};
