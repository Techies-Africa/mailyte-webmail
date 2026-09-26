import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Stream one attachment's bytes through to the browser (PRD P6).
 *
 * Two modes. The default is a DOWNLOAD: the mail server's own headers pass
 * through verbatim -- Content-Disposition: attachment, the allowlisted or
 * downgraded type, nosniff.
 *
 * `?disposition=inline` asks for a PREVIEW in the browser instead, and is
 * honoured only for types a browser renders without executing anything:
 * raster images, PDF, plain text, audio and video. Everything else -- HTML,
 * SVG, Office files, archives -- still downloads, because a sender-supplied
 * document rendered on this origin is stored XSS. Even the allowed previews
 * carry a sandboxing CSP, so a mislabelled file cannot run script or reach
 * the session cookie.
 */
const PREVIEWABLE = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'video/ogg',
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id, index } = await params;
  const wantsPreview = request.nextUrl.searchParams.get('disposition') === 'inline';

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
  headers.set('X-Content-Type-Options', 'nosniff');

  const type = (upstream.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (wantsPreview && PREVIEWABLE.has(type)) {
    // Keep the server's filename (the filename*= part) so "Save" in the
    // browser's viewer still names the file properly; only the disposition
    // word changes.
    const disposition = upstream.headers.get('content-disposition') ?? '';
    const filenamePart = disposition.replace(/^\s*attachment\s*;?\s*/i, '').trim();
    headers.set('Content-Disposition', filenamePart ? `inline; ${filenamePart}` : 'inline');
    // Opaque origin, no script, no network: a preview can only be looked at.
    // Chrome's PDF viewer and the built-in image/media viewers all work under
    // this. `frame-ancestors 'none'` keeps the preview out of anyone's iframe.
    headers.set('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self'; sandbox; frame-ancestors 'none'");
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  }

  return new NextResponse(upstream.body, { status: 200, headers });
}
