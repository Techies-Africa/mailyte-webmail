import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken, MAILBOX_COOKIE_NAME } from '@/lib/webmail/server';

export async function POST() {
  const token = await mailboxToken();

  if (token) {
    await fetch(`${apiBaseUrl()}/mailbox-auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {
      // Best-effort -- the cookie gets cleared either way below, so a
      // failed backend revoke doesn't strand the user logged in visibly.
    });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete(MAILBOX_COOKIE_NAME);
  return response;
}
