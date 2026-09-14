import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Saved contacts: the CardDAV address book.
 *
 * Not to be confused with /api/webmail/contacts, which is compose
 * autocomplete harvested from message headers. These are real cards that sync
 * to a phone; those are derived from mail that already exists.
 */
export async function GET(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const book = request.nextUrl.searchParams.get('book') || 'default';
  const res = await fetch(
    `${apiBaseUrl()}/mailbox/address-book/contacts?book=${encodeURIComponent(book)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  );
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function POST(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const book = request.nextUrl.searchParams.get('book') || 'default';
  const body = await request.json().catch(() => ({}));
  const res = await fetch(
    `${apiBaseUrl()}/mailbox/address-book/contacts?book=${encodeURIComponent(book)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
