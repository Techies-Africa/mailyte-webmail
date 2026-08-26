import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, Monitor, Info } from 'lucide-react';
import {
  beginTwoFactor,
  confirmTwoFactor,
  disableTwoFactor,
  getSecurity,
  listSessions,
  revokeSession,
  type ApiSecurity,
  type ApiSession,
  type ApiTwoFactorEnrolment,
} from '@/lib/webmail/client';

/**
 * Two-factor and sign-in history for the mailbox holder (PRD S3).
 *
 * The scope caveat is stated on screen, not buried: this protects webmail
 * sign-in and nothing else, because Dovecot IMAP and Postfix SMTP AUTH have
 * no TOTP path in this stack. A security control that lets someone believe
 * their mailbox is closed when their mail app still opens it with a
 * password is worse than no control -- they stop taking other precautions.
 */
export default function WebmailSecuritySection({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [security, setSecurity] = useState<ApiSecurity | null>(null);
  const [sessions, setSessions] = useState<ApiSession[]>([]);
  const [enrolment, setEnrolment] = useState<ApiTwoFactorEnrolment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disarming, setDisarming] = useState(false);

  const refresh = async () => {
    const [status, history] = await Promise.all([
      getSecurity(onUnauthorized),
      listSessions(onUnauthorized),
    ]);
    if (status.success) setSecurity(status.data);
    if (history.success) setSessions(history.data.sessions);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!security) {
    return <p className="text-sm text-gray-500">Loading security settings…</p>;
  }

  const start = async () => {
    setError(null);
    setBusy(true);
    const result = await beginTwoFactor(onUnauthorized);
    setBusy(false);
    if (!result.success) {
      setError(result.message);
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
    <div className="space-y-5" data-shortcuts="off">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {security.two_factor_enabled ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}
          Two-factor authentication
        </h3>

        <p className="flex items-start gap-1.5 text-xs text-gray-500 mb-3">
          <Info size={13} className="mt-0.5 flex-shrink-0" />
          Protects signing in to webmail. Mail apps set up with your mailbox password
          (IMAP/SMTP) are not affected and will keep working.
        </p>

        {error && (
          <p className="mb-3 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        {security.two_factor_enabled && !disarming && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-green-700 dark:text-green-400">
              On · {security.recovery_codes_remaining} recovery code
              {security.recovery_codes_remaining === 1 ? '' : 's'} left
            </span>
            <button
              onClick={() => {
                setDisarming(true);
                setError(null);
              }}
              className="text-sm text-red-600 hover:underline underline-offset-2"
            >
              Turn off
            </button>
          </div>
        )}

        {security.two_factor_enabled && disarming && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code from your app"
              className="w-48 text-sm px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-transparent"
            />
            <button
              onClick={() => void turnOff()}
              disabled={busy || code.trim() === ''}
              className="px-3 py-1.5 text-sm rounded-md bg-red-600 text-white disabled:opacity-50"
            >
              Turn off
            </button>
            <button
              onClick={() => {
                setDisarming(false);
                setCode('');
              }}
              className="px-3 py-1.5 text-sm text-gray-500"
            >
              Cancel
            </button>
          </div>
        )}

        {!security.two_factor_enabled && !enrolment && (
          <button
            onClick={() => void start()}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-black disabled:opacity-50"
          >
            {busy ? 'Setting up…' : 'Set up'}
          </button>
        )}

        {!security.two_factor_enabled && enrolment && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Scan this with your authenticator app, then enter the code it shows.
            </p>
            <div
              className="inline-block bg-white p-2 rounded border border-gray-200"
              // The SVG is generated server-side by BaconQrCode from the
              // enrolment secret -- not remote content, and not user input.
              dangerouslySetInnerHTML={{ __html: enrolment.qr_code_svg }}
            />
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">Can&rsquo;t scan? Enter this key instead</summary>
              <code className="mt-1 block break-all font-mono text-gray-700 dark:text-gray-300">
                {enrolment.secret}
              </code>
            </details>

            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Save these recovery codes
              </p>
              <p className="text-xs text-gray-500 mb-1">
                Each works once, and this is the only time they are shown. They are how you get
                in if you lose your phone.
              </p>
              <div className="grid grid-cols-2 gap-1 font-mono text-xs text-gray-700 dark:text-gray-300">
                {enrolment.recovery_codes.map((recovery) => (
                  <span key={recovery}>{recovery}</span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code"
                inputMode="numeric"
                className="w-40 text-sm px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-transparent"
              />
              <button
                onClick={() => void confirm()}
                disabled={busy || code.trim() === ''}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-black disabled:opacity-50"
              >
                {busy ? 'Checking…' : 'Turn on'}
              </button>
              <button
                onClick={() => {
                  setEnrolment(null);
                  setCode('');
                }}
                className="px-3 py-1.5 text-sm text-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          <Monitor size={15} /> Recent webmail sign-ins
        </h3>
        <p className="text-xs text-gray-500 mb-2">
          Webmail only — signing in from a mail app goes straight to the mail server and is not
          listed here.
        </p>

        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {sessions.slice(0, 8).map((session) => (
            <li key={session.id} className="py-2 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="text-gray-700 dark:text-gray-300">
                  {session.signed_in_at ? new Date(session.signed_in_at).toLocaleString() : '—'}
                  {session.current && <span className="ml-2 text-xs text-primary">this device</span>}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {session.ip_address ?? 'unknown address'}
                  {session.user_agent ? ` · ${session.user_agent}` : ''}
                </div>
              </div>
              {session.active && !session.current && (
                <button
                  onClick={async () => {
                    await revokeSession(session.id, onUnauthorized);
                    await refresh();
                  }}
                  className="text-xs text-red-600 hover:underline underline-offset-2 flex-shrink-0"
                >
                  Sign out
                </button>
              )}
              {session.revoked && <span className="text-xs text-gray-400">signed out</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
