import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, readAccountStore, withAccount, writeAccountStore } from '@/lib/webmail/server';

/**
 * Sign in with a one-time hand-off code (plans/36-partners, phase 5).
 *
 * A partner who runs this mailbox opened it from their dashboard: the
 * platform made a code that lives for a minute, and /login?handoff=<code>
 * lands here. The mail server exchanges it for the same session /login
 * issues, so everything after this line is the login route's: the second
 * factor is still asked, a temporary password still forces a change, and
 * the account store gains the mailbox the same way.
 *
 * No Turnstile: the code is the proof, and it is spent on success.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body?.code || typeof body.code !== 'string') {
    return NextResponse.json({ success: false, message: 'This sign-in link is not complete.' }, { status: 422 });
  }

  const forwardedFor = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
  const userAgent = request.headers.get('user-agent');

  const backendRes = await fetch(`${apiBaseUrl()}/mailbox-auth/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
    },
    body: JSON.stringify({
      code: body.code,
      two_factor_code: body.two_factor_code,
    }),
  });

  const data = await backendRes.json().catch(() => ({}));
  const ok = data?.success === true || data?.type === 'success';
  const message = data?.message ?? data?.msg;

  if (!backendRes.ok || !ok) {
    return NextResponse.json(
      { success: false, message: message ?? 'This sign-in link has expired. Ask for a new one.' },
      { status: backendRes.status || 401 },
    );
  }

  if (data?.data?.two_factor_required === true) {
    return NextResponse.json({
      success: true,
      two_factor_required: true,
      email_address: data?.data?.email_address ?? null,
      message: message ?? 'Enter the code from the authenticator app',
    });
  }

  const mustChangePassword = data?.data?.must_change_password === true;
  const email: string = data?.data?.email_account?.email_address ?? data?.data?.email_address;

  const current = await readAccountStore();
  const next = withAccount(current, {
    email,
    token: data.data.token,
    expires_at: data.data.expires_at,
  });

  const response = NextResponse.json({
    success: true,
    email_account: data.data.email_account,
    must_change_password: mustChangePassword,
    password_change_reason: data?.data?.password_change_reason ?? null,
    signed_in_via: data?.data?.signed_in_via ?? null,
    accounts: next.accounts.map((a) => a.email),
  });
  writeAccountStore(response, next);

  return response;
}
