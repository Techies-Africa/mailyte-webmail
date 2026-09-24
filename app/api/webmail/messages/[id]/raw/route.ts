import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * The original message, bytes as Dovecot holds them (RFC 822).
 *
 * Streamed through exactly as the attachment route does, with the server's
 * own Content-Disposition (always an attachment named *.eml) forwarded rather
 * than rebuilt. Behind "Download original" in the reading pane.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id } = await params;

  const upstream = await fetch(`${apiBaseUrl()}/mailbox/messages/${encodeURIComponent(id)}/raw`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const data = await upstream.json().catch(() => ({ message: 'Message not available' }));
    return NextResponse.json(data, { status: upstream.status });
  }

  const headers = new Headers();
  for (const header of ['content-type', 'content-length', 'content-disposition', 'x-content-type-options']) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  if (!headers.has('content-disposition')) {
    headers.set('content-disposition', 'attachment; filename="message.eml"');
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, no-store');

  return new NextResponse(upstream.body, { status: 200, headers });
}
