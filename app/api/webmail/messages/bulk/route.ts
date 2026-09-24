import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

// One action on many messages in one request: the mail server groups them by
// folder and issues one IMAP command per folder, where one request per
// message would open one IMAP connection per message. Only used when the
// server says it has the endpoint (the `bulk_actions` capability); the body
// and the per-message results are passed through unchanged.
export async function POST(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  const res = await fetch(`${apiBaseUrl()}/mailbox/messages/bulk`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
