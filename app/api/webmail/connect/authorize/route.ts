import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * An AI app (ChatGPT, Claude) asking to act for this mailbox: the approve
 * page reads what it asks for, then approves it. The mail server checks the
 * app, its return address and PKCE, and answers with where the browser goes
 * next; the signed-in session is the only thing that says which mailbox.
 */
export async function GET(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const res = await fetch(`${apiBaseUrl()}/mailbox/connect/authorize${request.nextUrl.search}`, {
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
  // JSON only: a form on another site cannot send it without asking first,
  // on top of the session cookie being SameSite=Lax.
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ success: false, message: 'Send JSON.' }, { status: 415 });
  }
  const body = await request.json().catch(() => ({}));
  const res = await fetch(`${apiBaseUrl()}/mailbox/connect/authorize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
