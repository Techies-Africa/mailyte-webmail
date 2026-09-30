import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * The Files library: every attachment in the mailbox, newest first.
 *
 * `q` narrows by file name, subject, sender or recipient; `kind` by type
 * (images, pdfs, documents, ...); `person` by who it came from or went to;
 * `direction` received or sent; `since`/`until` by date; `min_size`/`max_size`
 * by bytes; `sort` newest, oldest, largest, smallest or name. `cursor` is
 * handed back as `next_cursor` on each page.
 */
export async function GET(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const url = new URL(`${apiBaseUrl()}/mailbox/files`);
  for (const key of ['q', 'kind', 'person', 'direction', 'since', 'until', 'min_size', 'max_size', 'sort', 'cursor', 'limit'] as const) {
    const value = params.get(key);
    if (value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
