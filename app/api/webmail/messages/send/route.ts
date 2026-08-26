import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Send.
 *
 * Compose posts multipart/form-data once attachments exist (PRD P7), and
 * JSON when it has none. The multipart body is forwarded as a stream rather
 * than parsed and rebuilt here, so a 25 MB attachment never becomes a 25 MB
 * string in this process -- the Content-Type header carries the boundary
 * through with it.
 */
export async function POST(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  const target = `${apiBaseUrl()}/mailbox/messages/send`;

  let res: Response;
  if (contentType.includes('multipart/form-data')) {
    res = await fetch(target, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body: request.body,
      // Required by undici whenever a stream is used as a request body.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
  } else {
    const body = await request.json().catch(() => ({}));
    res = await fetch(target, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
