'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import AuthLayout from '@/components/auth/AuthLayout';
import WebmailInboxPreview from '@/components/auth/WebmailInboxPreview';

/**
 * Mirrors the mail server's own policy (worker/api/utils/auth.py,
 * validate_password_strength): 12+ characters, letters and numbers, and not
 * on its common-password list.
 *
 * The list is deliberately not copied here -- it is long, it lives on the
 * server, and a stale copy would start disagreeing with the thing that
 * actually decides. That one rule stays a server-side rejection, surfaced
 * from the 422 body, which carries the failing rule as its message.
 */
const MIN_LENGTH = 12;

function localPolicyError(password: string): string | null {
  if (password.length === 0) return null;
  if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password)) return 'Include at least one letter.';
  if (!/\d/.test(password)) return 'Include at least one number.';
  return null;
}

const REASON_COPY: Record<string, string> = {
  temporary: 'This mailbox was set up with a starter password. Choose your own to continue.',
  admin_reset: 'An administrator reset this mailbox. Choose a new password to continue.',
  expired: 'This password has expired. Choose a new one to continue.',
};

const trustCues = [
  { icon: ShieldCheck, label: 'Only you will know it' },
  { icon: Smartphone, label: 'Updates your mail apps too' },
  { icon: KeyRound, label: 'Takes a moment' },
];

function ChangePasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason') ?? 'temporary';

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const policyError = localPolicyError(newPassword);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    !policyError &&
    !mismatch &&
    confirmPassword.length > 0 &&
    !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/webmail/security/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && (data?.success === true || data?.type === 'success')) {
        // The forced-change flag is cleared server-side by that call, so the
        // inbox will load from here. Every OTHER session of this mailbox was
        // signed out; this one survives on purpose.
        router.push('/');
        return;
      }

      // Each status needs a different thing from the reader, so they are told
      // apart rather than collapsed into "something went wrong". The server's
      // own message is preferred where it carries the specific failing rule.
      const serverMessage = data?.message ?? data?.msg ?? data?.detail?.msg;
      if (res.status === 401) {
        setError('That current password is not right. It is the one you just signed in with.');
      } else if (res.status === 409) {
        setError('That is the password you already have. Choose a different one.');
      } else if (res.status === 422) {
        setError(serverMessage ?? 'That password does not meet the policy.');
      } else if (res.status === 429) {
        setError('Too many attempts. Wait a few minutes and try again.');
      } else if (res.status === 502) {
        setError('The mail server could not be reached, so nothing was changed. Try again.');
      } else {
        setError(serverMessage ?? 'Could not change the password. Try again.');
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/40 focus:border-primary focus:ring-2 focus:ring-ring/30';

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
        {REASON_COPY[reason] ?? REASON_COPY.temporary}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="current_password" className="block text-sm font-medium text-foreground">
            Current password
          </label>
          <input
            id="current_password"
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="The password you just signed in with"
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new_password" className="block text-sm font-medium text-foreground">
            New password
          </label>
          <div className="relative">
            <input
              id="new_password"
              type={showNew ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={`At least ${MIN_LENGTH} characters`}
              className={`${inputClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              aria-label={showNew ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
            >
              {showNew ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          {policyError ? (
            <p className="text-xs text-destructive">{policyError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              At least {MIN_LENGTH} characters, with letters and numbers.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm_password" className="block text-sm font-medium text-foreground">
            Confirm new password
          </label>
          <input
            id="confirm_password"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Type it again"
            className={inputClass}
          />
          {mismatch && <p className="text-xs text-destructive">These do not match.</p>}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Set password and continue'}
        </button>
      </form>

      {/* Said plainly, because it is the surprising part: the change is not
          confined to the browser. Dovecot's auth cache is flushed by the same
          request, so a phone or desktop mail client set up with the old
          password stops working the moment this succeeds. */}
      <p className="text-xs text-muted-foreground">
        This is the password for your mail apps too. If you have this mailbox set up on a phone or
        in a desktop mail client, update it there after this.
      </p>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <AuthLayout
      title="Set a new password"
      description="Choose a password only you know. You will use it here and in any mail app."
      panelHeadline={
        <>
          One step,
          <br />
          <span className="bg-gradient-to-r from-primary to-[#FF9900] bg-clip-text text-transparent">
            then your mail.
          </span>
        </>
      }
      panelDescription="Set your own password and your inbox opens straight away."
      panelVisual={<WebmailInboxPreview />}
      trustCues={trustCues}
    >
      {/* useSearchParams needs a Suspense boundary or the whole route opts out
          of static rendering at build time. */}
      <Suspense fallback={null}>
        <ChangePasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
