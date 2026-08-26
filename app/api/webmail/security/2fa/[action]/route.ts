import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * Two-factor enrolment steps (PRD S3): begin, confirm, disable.
 *
 * The action is allowlisted rather than passed through -- a path segment
 * from the URL must not be able to address an arbitrary upstream route.
 */
const ACTIONS = new Set(['begin', 'confirm', 'disable']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const { action } = await params;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));

  const res = await fetch(`${apiBaseUrl()}/mailbox/security/2fa/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
