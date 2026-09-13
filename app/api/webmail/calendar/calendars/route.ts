import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/** Calendars in this mailbox. Scheduling inbox/outbox are filtered out server-side. */
export async function GET() {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const res = await fetch(`${apiBaseUrl()}/mailbox/calendars`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
