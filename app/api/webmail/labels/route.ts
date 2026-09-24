import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Every label in use in this mailbox. Labels are IMAP keywords on the mail
 * server; this is the union across folders, for the picker and the rail.
 */
export async function GET() {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const res = await fetch(`${apiBaseUrl()}/mailbox/labels`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
