import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Discard a draft.
 *
 * This is a real expunge, and the only one outside Trash. The mail server
 * verifies server-side that the message is actually in Drafts before
 * honouring it, so this route cannot be pointed at live mail.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id } = await params;

  const res = await fetch(`${apiBaseUrl()}/mailbox/messages/draft/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
