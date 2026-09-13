import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Change this mailbox's own password.
 *
 * The one route a session carrying a temporary password is allowed to call
 * besides sign-out: the mail server verifies `current_password` by IMAP LOGIN
 * against Dovecot, applies the platform password policy to `new_password`,
 * flushes Dovecot's auth cache so IMAP and SMTP honour the change at once,
 * signs out every OTHER session of this mailbox, and clears any pending
 * forced change.
 *
 * The upstream status is passed through untouched rather than flattened to a
 * generic failure -- 401 (wrong current password), 409 (reused), 422 (weak,
 * with the failing rule in the message) and 429 (locked out) each need a
 * different thing from the person, and the screen tells them apart by status.
 */
export async function POST(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  const res = await fetch(`${apiBaseUrl()}/mailbox/security/password`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      current_password: body?.current_password,
      new_password: body?.new_password,
    }),
    cache: 'no-store',
  });

  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
