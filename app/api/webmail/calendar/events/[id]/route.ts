import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

type Params = { params: Promise<{ id: string }> };

function target(request: NextRequest, id: string): string {
  const calendar = request.nextUrl.searchParams.get('calendar') || 'default';
  // The etag rides through as a query parameter and becomes an If-Match on
  // the server. Without it two people editing the same event silently
  // overwrite one another.
  const etag = request.nextUrl.searchParams.get('etag');
  const suffix = etag ? `?etag=${encodeURIComponent(etag)}` : '';
  return `${apiBaseUrl()}/mailbox/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(id)}${suffix}`;
}

export async function GET(request: NextRequest, { params }: Params) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const { id } = await params;
  const res = await fetch(target(request, id), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const res = await fetch(target(request, id), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }
  const { id } = await params;
  const res = await fetch(target(request, id), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
