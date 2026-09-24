'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Eye, EyeOff, KeyRound } from 'lucide-react';
import AuthLayout from '@/components/auth/AuthLayout';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { listAccounts, switchAccount, type AccountSummary } from '@/lib/webmail/client';
import { announceAccountChange, resetSessionState } from '@/lib/webmail/query/session';
import { dropAllHeld } from '@/lib/webmail/query/opRunner';

export default function WebmailLoginPage() {
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Set once the server has accepted the password and asked for a code.
  const [twoFactor, setTwoFactor] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // `/login?add=1` is the rail's "Add another account": same form, and the
  // accounts already here stay signed in. Without it, this page is where a
  // person lands with no active session -- but other mailboxes may still be
  // signed in on this browser, so they are offered before the form.
  const [adding, setAdding] = useState(false);
  const [existing, setExisting] = useState<AccountSummary[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);

  // A 401 reaches this page by a client-side redirect, which keeps the page's
  // memory -- and with it the previous session's cached mail. Drop it here,
  // before anyone signs in as someone else.
  const queryClient = useQueryClient();
  useEffect(() => {
    // Anything still held belonged to a session that has ended.
    dropAllHeld(queryClient);
    queryClient.clear();
    resetSessionState();
  }, [queryClient]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdding(new URLSearchParams(window.location.search).get('add') === '1');
    void listAccounts().then((result) => {
      if (result.success && Array.isArray(result.data?.accounts)) setExisting(result.data.accounts);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/webmail-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_address: emailAddress,
          password,
          two_factor_code: twoFactor ? code.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        setError(data.message || 'Invalid email address or password');
        return;
      }

      // The password was right; the mailbox wants a second factor. No
      // session yet -- the next submit carries the code.
      if (data.two_factor_required) {
        setTwoFactor(true);
        setCode('');
        return;
      }

      // Non-sensitive display info only -- the session token itself lives in
      // an HttpOnly cookie the login route just set, never here.
      sessionStorage.setItem('mailyte_mailbox_display', JSON.stringify(data.email_account));
      // This mailbox is now the active one for every tab on this browser.
      announceAccountChange();

      // A temporary or admin-reset password buys a session that can do
      // exactly two things: set a real password, and sign out.
      if (data.must_change_password) {
        const reason = data.password_change_reason
          ? `?reason=${encodeURIComponent(data.password_change_reason)}`
          : '';
        router.push(`/change-password${reason}`);
        return;
      }

      // A full navigation rather than router.push: the inbox must start from
      // nothing, and if it was already mounted behind this page its state
      // belongs to whichever account was active before.
      window.location.assign('/');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const continueAs = async (email: string) => {
    setSwitching(email);
    const message = await switchAccount(email);
    if (message) {
      setSwitching(null);
      setError(message);
    }
  };

  const title = twoFactor ? 'Enter your code' : adding ? 'Add another account' : 'Sign in to your mail';
  const description = twoFactor
    ? `Open your authenticator app and enter the code for ${emailAddress}.`
    : adding
      ? `You stay signed in to ${existing.length === 1 ? existing[0].email : 'your other accounts'}. Switch between them from the account menu.`
      : 'Use your mailbox address and password. The same ones your mail apps use.';

  return (
    <AuthLayout title={title} description={description}>
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
            {error}
          </div>
        )}

        {!adding && !twoFactor && existing.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-foreground">Continue as</p>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {existing.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    disabled={switching !== null}
                    onClick={() => void continueAs(account.email)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted disabled:opacity-60"
                  >
                    <Avatar name={account.email} email={account.email} size={28} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{account.email}</span>
                    {switching === account.email ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground" />
                    ) : (
                      <ArrowRight size={14} className="shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              or sign in to another
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {!twoFactor ? (
            <>
              <div>
                <Label htmlFor="email_address">Email address</Label>
                <Input
                  id="email_address"
                  type="email"
                  required
                  autoComplete="username"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  placeholder="you@yourdomain.com"
                  className="font-mono text-[13.5px]"
                />
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="two_factor_code">Authentication code</Label>
              <div className="relative">
                <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="two_factor_code"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123 456"
                  className="pl-9 font-mono text-[15px] tracking-[0.2em]"
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">Lost your phone? A recovery code works here too.</p>
            </div>
          )}

          <Button type="submit" variant="primary" size="md" busy={loading} className="w-full">
            {loading ? 'Signing in…' : twoFactor ? 'Continue' : adding ? 'Add account' : 'Sign in'}
          </Button>

          {twoFactor && (
            <button
              type="button"
              onClick={() => {
                setTwoFactor(false);
                setCode('');
                setError(null);
              }}
              className="block w-full text-center text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              Use a different account
            </button>
          )}

          {adding && !twoFactor && (
            <a href="/" className="block w-full text-center text-sm font-semibold text-muted-foreground hover:text-foreground">
              Back to mail
            </a>
          )}
        </form>
      </div>
    </AuthLayout>
  );
}
