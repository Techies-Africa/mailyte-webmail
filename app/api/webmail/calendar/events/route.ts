import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Events overlapping a time range, and event creation.
 *
 * The range is required and bounded by the server. Expansion of recurring
 * events happens there too -- the browser never sees an RRULE it has to
 * expand itself, because two expanders eventually disagree about a DST
 * boundary and the disagreement looks like a meeting at the wrong hour.
 */
export async function GET(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const calendar = params.get('calendar') || 'default';
  const query = new URLSearchParams({
    start: params.get('start') ?? '',
    end: params.get('end') ?? '',
  });
  const res = await fetch(
    `${apiBaseUrl()}/mailbox/calendars/${encodeURIComponent(calendar)}/events?${query}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  );
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function POST(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const calendar = request.nextUrl.searchParams.get('calendar') || 'default';
  const body = await request.json().catch(() => ({}));
  const res = await fetch(
    `${apiBaseUrl()}/mailbox/calendars/${encodeURIComponent(calendar)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
