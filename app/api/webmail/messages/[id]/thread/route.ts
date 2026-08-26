import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * The other messages in a message's conversation (PRD F1). Returns an empty
 * list for a message that stands alone, which is the common case -- the view
 * renders a single message then, not a one-item thread.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id } = await params;

  const res = await fetch(
    `${apiBaseUrl()}/mailbox/messages/${encodeURIComponent(id)}/thread`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  );
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
