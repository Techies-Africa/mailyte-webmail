'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff, Monitor, Info } from 'lucide-react';
import {
  beginTwoFactor,
  confirmTwoFactor,
  disableTwoFactor,
  revokeSession,
  type ApiSession,
  type ApiTwoFactorEnrolment,
} from '@/lib/webmail/client';
import { formatDateTime } from '@/lib/webmail/dates';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { StatusBadge } from '@/components/ui/Pill';
import { settingsKeys, useSecurity, useSessions } from '@/lib/webmail/query/settingsQueries';

const NO_SESSIONS: ApiSession[] = [];

/**
 * Two-factor and sign-in history for the mailbox holder (PRD S3).
 *
 * The scope caveat is stated on screen, not buried: this protects webmail
 * sign-in and nothing else, because Dovecot IMAP and Postfix SMTP AUTH have
 * no TOTP path in this stack.
 */
export default function WebmailSecuritySection({ onUnauthorized }: { onUnauthorized: () => void }) {
  // Cached: a second visit shows the status and the sign-ins at once.
  const queryClient = useQueryClient();
  const securityResult = useSecurity(onUnauthorized);
  const security = securityResult.data ?? null;
  const sessions = useSessions(onUnauthorized).data ?? NO_SESSIONS;
  const [enrolment, setEnrolment] = useState<ApiTwoFactorEnrolment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disarming, setDisarming] = useState(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: settingsKeys.security }),
      queryClient.invalidateQueries({ queryKey: settingsKeys.sessions }),
    ]);

  if (!security) {
    // It used to say "Loading" for ever when the request failed.
    if (securityResult.isError) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-destructive" role="alert">
            {securityResult.error.message}
          </p>
          <Button size="xs" onClick={() => void securityResult.refetch()}>
            Try again
          </Button>
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground">Loading security settings…</p>;
  }

  /** Signed out on the list at once; back as it was, with the reason, if the server refuses. */
  const signOutSession = async (session: ApiSession) => {
    setError(null);
    const before = queryClient.getQueryData<ApiSession[]>(settingsKeys.sessions);
    queryClient.setQueryData<ApiSession[]>(settingsKeys.sessions, (list) =>
      list?.map((s) => (s.id === session.id ? { ...s, active: false, revoked: true } : s)),
    );
    const result = await revokeSession(session.id, onUnauthorized);
    if (!result.success) {
      queryClient.setQueryData(settingsKeys.sessions, before);
      setError(result.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: settingsKeys.sessions });
  };

  const start = async () => {
    setError(null);
    setBusy(true);
    const result = await beginTwoFactor(onUnauthorized);
    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    if (!result.data) {
      setError('The mail server did not return an enrolment. Please try again.');
      return;
    }
    setEnrolment(result.data);
  };

  const confirm = async () => {
    setError(null);
    setBusy(true);
    const result = await confirmTwoFactor(code.trim(), onUnauthorized);
    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setEnrolment(null);
    setCode('');
    await refresh();
  };

  const turnOff = async () => {
    setError(null);
    setBusy(true);
    const result = await disableTwoFactor(code.trim(), onUnauthorized);
    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setDisarming(false);
    setCode('');
    await refresh();
  };

  return (
    <div className="space-y-8" data-shortcuts="off">
      <section>
        <h3 className="mb-1 flex items-center gap-2 font-display text-[14px] font-semibold">
          {security.two_factor_enabled ? (
            <ShieldCheck size={15} className="text-success" />
          ) : (
            <ShieldOff size={15} className="text-muted-foreground" />
          )}
          Two-factor authentication
          {security.two_factor_enabled && <StatusBadge tone="success">On</StatusBadge>}
        </h3>

        <p className="mb-4 flex max-w-prose items-start gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
          <Info size={13} className="mt-1 shrink-0" />
          Protects signing in to webmail. Mail apps set up with your mailbox password (IMAP/SMTP) are not affected
          and will keep working.
        </p>

        {error && (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {security.two_factor_enabled && !disarming && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">
              {security.recovery_codes_remaining} recovery code{security.recovery_codes_remaining === 1 ? '' : 's'} left
            </span>
            <Button
              size="xs"
              variant="danger"
              onClick={() => {
                setDisarming(true);
                setError(null);
              }}
            >
              Turn off
            </Button>
          </div>
        )}

        {security.two_factor_enabled && disarming && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code from your app"
              inputMode="numeric"
              className="w-48 font-mono"
            />
            <Button variant="danger" busy={busy} disabled={code.trim() === ''} onClick={() => void turnOff()}>
              Turn off
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDisarming(false);
                setCode('');
              }}
            >
              Cancel
            </Button>
          </div>
        )}

        {!security.two_factor_enabled && !enrolment && (
          <Button variant="primary" busy={busy} onClick={() => void start()}>
            {busy ? 'Setting up…' : 'Set up two-factor'}
          </Button>
        )}

        {!security.two_factor_enabled && enrolment && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Scan this with your authenticator app, then enter the code it shows.</p>
            <div
              className="inline-block rounded-lg border border-border bg-white p-2"
              // The SVG is generated server-side from the enrolment secret --
              // not remote content, and not user input.
              dangerouslySetInnerHTML={{ __html: enrolment.qr_code_svg }}
            />
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Can&rsquo;t scan? Enter this key instead</summary>
              <code className="mt-1 block break-all rounded-md bg-muted px-2 py-1 font-mono text-foreground">{enrolment.secret}</code>
            </details>

            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">Save these recovery codes</p>
              <p className="mb-2 text-xs text-muted-foreground">
                Each works once, and this is the only time they are shown. They are how you get in if you lose your
                phone.
              </p>
              <div className="grid grid-cols-2 gap-1 font-mono text-xs">
                {enrolment.recovery_codes.map((recovery) => (
                  <span key={recovery}>{recovery}</span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code"
                inputMode="numeric"
                className="w-40 font-mono"
              />
              <Button variant="primary" busy={busy} disabled={code.trim() === ''} onClick={() => void confirm()}>
                {busy ? 'Checking…' : 'Turn on'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEnrolment(null);
                  setCode('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-2 font-display text-[14px] font-semibold">
          <Monitor size={15} className="text-muted-foreground" /> Recent webmail sign-ins
        </h3>
        <p className="mb-3 text-[13px] text-muted-foreground">
          Webmail only — signing in from a mail app goes straight to the mail server and is not listed here.
        </p>

        <ul className="divide-y divide-border rounded-lg border border-border">
          {sessions.slice(0, 8).map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span>{session.signed_in_at ? formatDateTime(new Date(session.signed_in_at)) : '—'}</span>
                  {session.current && <StatusBadge tone="primary">this device</StatusBadge>}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {session.ip_address ?? 'unknown address'}
                  {session.user_agent ? ` · ${session.user_agent}` : ''}
                </div>
              </div>
              {session.active && !session.current && (
                <button
                  type="button"
                  onClick={() => void signOutSession(session)}
                  className="shrink-0 text-xs font-semibold text-destructive hover:underline"
                >
                  Sign out
                </button>
              )}
              {session.revoked && <span className="shrink-0 text-xs text-muted-foreground">signed out</span>}
            </li>
          ))}
          {sessions.length === 0 && <li className="px-3.5 py-3 text-sm text-muted-foreground">No sign-ins recorded yet.</li>}
        </ul>
      </section>
    </div>
  );
}
