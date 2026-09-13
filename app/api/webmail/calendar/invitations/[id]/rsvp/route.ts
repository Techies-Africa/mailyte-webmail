import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await fetch(
    `${apiBaseUrl()}/mailbox/calendar/invitations/${encodeURIComponent(id)}/rsvp`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
