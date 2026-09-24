'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import AuthLayout from '@/components/auth/AuthLayout';
import Button from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';

export default function WebmailLoginPage() {
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Set once the server has accepted the password and asked for a code. The
  // BFF forwards `two_factor_code`; without this step a mailbox with 2FA on
  // could never get past the prompt.
  const [twoFactor, setTwoFactor] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

      // A temporary or admin-reset password buys a session that can do
      // exactly two things: set a real password, and sign out.
      if (data.must_change_password) {
        const reason = data.password_change_reason
          ? `?reason=${encodeURIComponent(data.password_change_reason)}`
          : '';
        router.push(`/change-password${reason}`);
        return;
      }

      router.push('/');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={twoFactor ? 'Enter your code' : 'Sign in to your mail'}
      description={
        twoFactor
          ? `Open your authenticator app and enter the code for ${emailAddress}.`
          : 'Use your mailbox address and password. The same ones your mail apps use.'
      }
    >
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
            {error}
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
              <p className="mt-1.5 text-xs text-muted-foreground">
                Lost your phone? A recovery code works here too.
              </p>
            </div>
          )}

          <Button type="submit" variant="primary" size="md" busy={loading} className="w-full">
            {loading ? 'Signing in…' : twoFactor ? 'Continue' : 'Sign in'}
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
        </form>
      </div>
    </AuthLayout>
  );
}
