import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Invitations awaiting an answer -- the CalDAV scheduling inbox.
 *
 * The same collection Apple Calendar and DAVx5 read, so answering here and
 * answering on a phone cannot disagree about what is still outstanding.
 */
export async function GET() {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const res = await fetch(`${apiBaseUrl()}/mailbox/calendar/invitations`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
