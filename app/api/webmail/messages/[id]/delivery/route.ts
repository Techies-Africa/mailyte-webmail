import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * What happened to a message this mailbox sent: delivery per recipient, opens,
 * clicks and the spam score. Read-only, and optional: a mail server without
 * the feature (or with it switched off) answers 404 and the reading pane
 * simply shows nothing, so every failure here is passed straight through.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const { id } = await params;

  try {
    const res = await fetch(`${apiBaseUrl()}/mailbox/messages/${encodeURIComponent(id)}/delivery`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      // A slow mail server must not hold this request open: the panel is an extra.
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, message: 'Delivery details are unavailable' }, { status: 503 });
  }
}
