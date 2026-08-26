import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

// Proxies mark-read/mark-unread/star/unstar/move/trash -- one route instead
// of six near-identical files, since they're all "POST, forward the body,
// forward the status" with no per-action logic on this side.
const ALLOWED_ACTIONS = new Set(['mark-read', 'mark-unread', 'star', 'unstar', 'move', 'trash']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { id, action } = await params;
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));

  const res = await fetch(
    `${apiBaseUrl()}/mailbox/messages/${encodeURIComponent(id)}/${action}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
