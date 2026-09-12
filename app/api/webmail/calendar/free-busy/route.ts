import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * When are these people busy.
 *
 * Answers per address, and an address the server cannot speak for comes back
 * `known: false` rather than being omitted -- "we do not know" and "they are
 * free" must not look the same in a UI.
 */
export async function POST(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const res = await fetch(`${apiBaseUrl()}/mailbox/calendar/free-busy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
