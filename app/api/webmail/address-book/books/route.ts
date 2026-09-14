import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * The address books this mailbox can see: its own, plus anything shared with
 * it -- the company directory being the one that matters.
 *
 * Each carries `read_only` taken from the server's own privilege set, so the
 * UI hides editing controls on a collection the server would refuse to write
 * rather than offering a save that always fails.
 */
export async function GET() {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const res = await fetch(`${apiBaseUrl()}/mailbox/address-book/books`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
