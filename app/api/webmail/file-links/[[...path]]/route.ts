import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Files shared as download links: start, sign parts, finish, describe,
 * list and remove (the mail server's /mailbox/file-links).
 *
 * Small JSON bodies only. The file itself goes from the browser straight to
 * storage on the signed part URLs, never through here, so no request on this
 * route is big or slow enough to meet the server's time limits.
 *
 * Only the shapes the mail server serves are forwarded: an id, then at most
 * `parts` or `complete`.
 */
const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ACTIONS = new Set(['parts', 'complete']);

function upstreamPath(path: string[] | undefined): string | null {
  const segments = path ?? [];
  if (segments.length === 0) return '';
  if (!ID.test(segments[0])) return null;
  if (segments.length === 1) return `/${segments[0]}`;
  if (segments.length === 2 && ACTIONS.has(segments[1])) return `/${segments[0]}/${segments[1]}`;
  return null;
}

async function forward(request: NextRequest, params: Promise<{ path?: string[] }>, method: string) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const { path } = await params;
  const suffix = upstreamPath(path);
  if (suffix === null) {
    return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
  }

  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  };
  if (method === 'POST') {
    init.body = JSON.stringify(await request.json().catch(() => ({})));
  }

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/mailbox/file-links${suffix}`, init);
  } catch {
    return NextResponse.json(
      { success: false, message: 'Could not reach the mail server. Check your connection.' },
      { status: 502 },
    );
  }
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

type Context = { params: Promise<{ path?: string[] }> };

export function GET(request: NextRequest, { params }: Context) {
  return forward(request, params, 'GET');
}

export function POST(request: NextRequest, { params }: Context) {
  return forward(request, params, 'POST');
}

export function DELETE(request: NextRequest, { params }: Context) {
  return forward(request, params, 'DELETE');
}
