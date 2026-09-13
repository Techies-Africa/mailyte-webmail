import { NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl, MAILBOX_COOKIE_NAME } from '@/lib/webmail/server';

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
      // Dropping it here would make a correct code look like no code at all,
      // so 2FA could be enabled and then never satisfied.
      two_factor_code: body.two_factor_code,
    }),
  });

  const data = await backendRes.json().catch(() => ({}));

  // Accept both envelopes. Mailyte's mail server answers `{type, msg, data}`;
  // some deployments front it with a service that answers
  // `{success, message, data}`. Reading both means one client works against
  // either without a build flag. See lib/webmail/client.ts.
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

  // The mailbox was provisioned with a starter password, or an admin reset it
  // with temporary=true. The session is real and is issued as normal, but
  // every /api/v1/mailbox/* route except POST /security/password and sign-out
  // will answer 403 password_change_required until a new password is set --
  // so the client is told here, and sends the holder straight to the screen
  // that can clear it rather than into an inbox that cannot load.
  const mustChangePassword = data?.data?.must_change_password === true;

  const response = NextResponse.json({
    success: true,
    email_account: data.data.email_account,
    must_change_password: mustChangePassword,
    // temporary | expired | admin_reset -- worth showing, because "your
    // administrator reset this" and "this was the password you were given"
    // are different messages to the person reading the screen.
    password_change_reason: data?.data?.password_change_reason ?? null,
  });

  const expiresAt = new Date(data.data.expires_at);
  response.cookies.set(MAILBOX_COOKIE_NAME, data.data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return response;
}
