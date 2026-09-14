import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Cancel a scheduled send.
 *
 * Nothing is destroyed: the mail server moves the message back to Drafts and
 * forgets the schedule. Someone cancelling a send wants to change what they
 * wrote, not lose it.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id } = await params;

  const res = await fetch(
    `${apiBaseUrl()}/mailbox/messages/scheduled/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
