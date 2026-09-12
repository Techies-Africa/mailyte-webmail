import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

export async function DELETE(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await mailboxToken();
  if (!session) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const { token } = await params;
  const res = await fetch(
    `${apiBaseUrl()}/mailbox/calendar-subscriptions/${encodeURIComponent(token)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${session}` } },
  );
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
