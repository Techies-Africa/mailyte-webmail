import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, readAccountStore, withAccount, writeAccountStore } from '@/lib/webmail/server';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body?.email_address || !body?.password) {
    return NextResponse.json(
      { success: false, message: 'Email address and password are required' },
      { status: 422 },
    );
  }

  const backendRes = await fetch(`${apiBaseUrl()}/mailbox-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_address: body.email_address,
      password: body.password,
      // Forwarded when the caller is answering a two_factor_required prompt.
      two_factor_code: body.two_factor_code,
    }),
  });

  const data = await backendRes.json().catch(() => ({}));

  // Accept both envelopes: `{type,msg,data}` from the mail server, or
  // `{success,message,data}` from a service some deployments put in front.
  const ok = data?.success === true || data?.type === 'success';
  const message = data?.message ?? data?.msg;

  if (!backendRes.ok || !ok) {
    return NextResponse.json(
      { success: false, message: message ?? 'Invalid email address or password' },
      { status: backendRes.status || 401 },
    );
  }

  // The password was right but this mailbox has a second factor. A prompt,
  // not a session: no cookie is set, because no credential was issued.
  if (data?.data?.two_factor_required === true) {
    return NextResponse.json({
      success: true,
      two_factor_required: true,
      message: message ?? 'Enter the code from your authenticator app',
    });
  }

  // A starter or admin-reset password buys a session that can do exactly two
  // things: set a real password, and sign out. The client is told so it sends
  // the holder straight to the screen that can clear it.
  const mustChangePassword = data?.data?.must_change_password === true;

  const email: string =
    data?.data?.email_account?.email_address ?? data?.data?.email_address ?? body.email_address;

  // Signing in ADDS to the accounts already on this browser rather than
  // replacing them. Signing in to an address that is already here refreshes
  // its token. Either way the new one becomes active.
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
    accounts: next.accounts.map((a) => a.email),
  });
  writeAccountStore(response, next);

  return response;
}
