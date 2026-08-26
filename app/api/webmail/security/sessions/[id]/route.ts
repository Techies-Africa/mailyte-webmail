import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/** Sign a different device out. The API refuses the current session. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id } = await params;

  const res = await fetch(`${apiBaseUrl()}/mailbox/security/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
