import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Blocked senders.
 *
 * The mail server files mail from a blocked address into Junk at delivery
 * (a Sieve script it manages), before rules, forwarding or the vacation
 * reply run. Nothing is discarded. The endpoints have existed since the
 * standalone PRD and nothing in this client ever called them.
 */
export async function GET() {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const res = await fetch(`${apiBaseUrl()}/mailbox/blocked-senders`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  const res = await fetch(`${apiBaseUrl()}/mailbox/blocked-senders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
