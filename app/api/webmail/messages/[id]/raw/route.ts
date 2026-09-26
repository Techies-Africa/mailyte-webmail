import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * The original message, bytes as Dovecot holds them (RFC 822).
 *
 * Two modes. By default a DOWNLOAD: streamed through with the server's own
 * Content-Disposition (an attachment named *.eml). With `?format=text` the
 * same bytes come back as `text/plain` for the "Show original" page to read
 * -- never as message/rfc822 or anything a browser might interpret, and
 * under a sandboxing CSP, so the one thing a raw message can be on this
 * origin is text on a page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id } = await params;
  const asText = request.nextUrl.searchParams.get('format') === 'text';

  const upstream = await fetch(`${apiBaseUrl()}/mailbox/messages/${encodeURIComponent(id)}/raw`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const data = await upstream.json().catch(() => ({ message: 'Message not available' }));
    return NextResponse.json(data, { status: upstream.status });
  }

  const headers = new Headers();
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, no-store');

  if (asText) {
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    headers.set('Content-Disposition', 'inline');
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new NextResponse(upstream.body, { status: 200, headers });
  }

  for (const header of ['content-type', 'content-length', 'content-disposition']) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  if (!headers.has('content-disposition')) {
    headers.set('content-disposition', 'attachment; filename="message.eml"');
  }

  return new NextResponse(upstream.body, { status: 200, headers });
}
