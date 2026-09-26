import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Rename and delete a folder.
 *
 * Both existed on the mail server (PATCH/DELETE /mailbox/folders/{id}) and
 * had no route here, so a folder created from the sidebar could never be
 * renamed or removed from the sidebar. `id` is the value GET /folders returns
 * (an md5 of the name), which is what makes a name containing "/" addressable.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const res = await fetch(`${apiBaseUrl()}/mailbox/folders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id } = await params;

  const res = await fetch(`${apiBaseUrl()}/mailbox/folders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
