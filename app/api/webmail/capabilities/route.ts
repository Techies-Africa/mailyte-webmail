import { NextResponse } from 'next/server';
import { apiBaseUrl, mailboxToken } from '@/lib/webmail/server';

/**
 * What THIS deployment's mail server can actually do.
 *
 * The server has always answered this and the README has always promised the
 * behaviour it enables -- "Optional features are absent, not disabled, when
 * the server does not support them" -- but nothing in the client ever called
 * it. There was no proxy route at all, so every optional control rendered
 * unconditionally.
 *
 * The visible cost: a deployment with no AI endpoint configured still showed
 * "AI Write" and "AI Email Writer", and pressing them returned "Could not
 * generate a draft. Please try again." -- an error phrased as a transient
 * failure for something that could never have worked. The same applied to
 * rules, forwarding and the vacation responder without a Sieve master
 * credential.
 *
 * Distinct from /api/v1/capabilities, which reports the build's edition. This
 * one reports how this particular server is configured, which is the only
 * thing that can answer "is there an AI endpoint".
 */
export async function GET() {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const res = await fetch(`${apiBaseUrl()}/mailbox/capabilities`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));

  return NextResponse.json(data, { status: res.status });
}
