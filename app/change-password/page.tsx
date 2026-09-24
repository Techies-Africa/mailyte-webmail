'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { abortSessionChange } from '@/lib/webmail/query/session';
import { Eye, EyeOff, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import AuthLayout from '@/components/auth/AuthLayout';
import Button from '@/components/ui/Button';
import { Hint, Input, Label } from '@/components/ui/Field';

/**
 * Mirrors the mail server's own policy (validate_password_strength): 12+
 * characters, letters and numbers, and not on its common-password list. The
 * list is deliberately not copied here; that rule stays a server-side
 * rejection surfaced from the 422 body.
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
  { icon: Smartphone, label: 'Your mail apps use the same password' },
  { icon: KeyRound, label: 'Every other session is signed out' },
];

function ChangePasswordForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
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
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && (data?.success === true || data?.type === 'success')) {
        // A new password signs out every other session; start the inbox from nothing.
        queryClient.clear();
        // The sign-in that led here is complete and the page is not reloading:
        // actions may be sent again, in this session.
        abortSessionChange();
        router.push('/');
        return;
      }

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

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-warning/[0.12] p-3 text-sm text-warning">
        {REASON_COPY[reason] ?? REASON_COPY.temporary}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <Label htmlFor="current_password">Current password</Label>
          <Input
            id="current_password"
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="The password you just signed in with"
          />
        </div>

        <div>
          <Label htmlFor="new_password">New password</Label>
          <div className="relative">
            <Input
              id="new_password"
              type={showNew ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={`At least ${MIN_LENGTH} characters`}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              aria-label={showNew ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground"
            >
              {showNew ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
            </button>
          </div>
          {policyError ? (
            <p className="mt-1.5 text-xs text-destructive">{policyError}</p>
          ) : (
            <Hint>At least {MIN_LENGTH} characters, with letters and numbers.</Hint>
          )}
        </div>

        <div>
          <Label htmlFor="confirm_password">Confirm new password</Label>
          <Input
            id="confirm_password"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Type it again"
          />
          {mismatch && <p className="mt-1.5 text-xs text-destructive">These do not match.</p>}
        </div>

        <Button type="submit" variant="primary" size="md" disabled={!canSubmit} busy={loading} className="w-full">
          {loading ? 'Saving…' : 'Set password and continue'}
        </Button>
      </form>

      <p className="text-xs leading-relaxed text-muted-foreground">
        This is the password for your mail apps too. If you have this mailbox set up on a phone or in a desktop
        mail client, update it there after this.
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
          <span className="text-brand-gradient">then your mail.</span>
        </>
      }
      panelDescription="Set your own password and your inbox opens straight away."
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
