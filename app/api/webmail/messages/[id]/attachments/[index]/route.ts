import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Stream one attachment's bytes through to the browser (PRD P6).
 *
 * The body is passed through untouched rather than buffered, and the safety
 * headers the mail server sets are forwarded verbatim rather than rebuilt here:
 * Content-Disposition (always `attachment`, never inline), the allowlisted
 * or downgraded Content-Type, and nosniff. Re-deriving them in this tier
 * would mean two places that have to agree about what is safe to render.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id, index } = await params;

  const upstream = await fetch(
    `${apiBaseUrl()}/mailbox/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(index)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  );

  if (!upstream.ok) {
    const data = await upstream.json().catch(() => ({ message: 'Attachment not available' }));
    return NextResponse.json(data, { status: upstream.status });
  }

  const headers = new Headers();
  for (const header of [
    'content-type',
    'content-length',
    'content-disposition',
    'x-content-type-options',
    'content-security-policy',
  ]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  headers.set('Cache-Control', 'private, no-store');

  return new NextResponse(upstream.body, { status: 200, headers });
}
