import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Read-only .ics subscription links -- the only calendar path Outlook can
 * follow, since it does not speak CalDAV and gives an IMAP account no
 * calendar at all.
 */
export async function GET() {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const res = await fetch(`${apiBaseUrl()}/mailbox/calendar-subscriptions`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function POST(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const res = await fetch(`${apiBaseUrl()}/mailbox/calendar-subscriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
