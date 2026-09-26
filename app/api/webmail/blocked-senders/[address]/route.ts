import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { address } = await params;

  const res = await fetch(
    `${apiBaseUrl()}/mailbox/blocked-senders/${encodeURIComponent(address)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
