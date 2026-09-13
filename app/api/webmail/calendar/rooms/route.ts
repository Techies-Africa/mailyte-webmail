import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Rooms and equipment this mailbox may invite.
 *
 * Only here so the guest field can offer a list. Before it, the address was
 * the only handle anyone had on a room, and a room address typed from memory
 * is a booking that goes nowhere.
 */
export async function GET() {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const res = await fetch(`${apiBaseUrl()}/mailbox/calendar/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
