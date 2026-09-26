import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * The message list.
 *
 * folder/search/limit/offset are forwarded to the mail server, which resolves
 * them against IMAP SEARCH rather than filtering a page it already fetched
 * (PRD P3/P5). Omitting `folder` while passing `search` is how the client
 * asks for a whole-account search; the API treats a folderless browse as
 * the inbox.
 */
export async function GET(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const url = new URL(`${apiBaseUrl()}/mailbox/messages`);

  // `unread` and `starred` are the server's own filters (IMAP SEARCH UNSEEN /
  // FLAGGED). They were always accepted upstream and dropped here, which is
  // why the list could not be narrowed to unread without a search term.
  for (const key of ['folder', 'search', 'limit', 'offset', 'unread', 'starred', 'label', 'attachments'] as const) {
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
