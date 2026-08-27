'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Inbox, Send, Sparkles } from 'lucide-react';
import AuthLayout from '@/components/auth/AuthLayout';
import WebmailInboxPreview from '@/components/auth/WebmailInboxPreview';

// Plain language on purpose -- most people logging in here are checking
// their own email, not managing email infrastructure, and won't know (or
// need to know) what IMAP/SMTP mean.
const webmailTrustCues = [
  { icon: Inbox, label: 'See your real email' },
  { icon: Send, label: 'Send messages that really go out' },
  { icon: Sparkles, label: 'Help writing replies' },
];

export default function WebmailLoginPage() {
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
        body: JSON.stringify({ email_address: emailAddress, password }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.message || 'Invalid email address or password');
        return;
      }

      // Non-sensitive display info only -- the session token itself lives
      // in an HttpOnly cookie the login route just set, never here.
      sessionStorage.setItem('mailyte_mailbox_display', JSON.stringify(data.email_account));
      router.push('/');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Check your mail"
      description="Log in with your mailbox address to read and send real mail from any browser."
      panelHeadline={
        <>
          Your inbox,
          <br />
          <span className="bg-gradient-to-r from-primary to-[#FF9900] bg-clip-text text-transparent">
            anywhere.
          </span>
        </>
      }
      panelDescription="Check and send real email from any web browser — nothing to install, nothing to set up."
      panelVisual={<WebmailInboxPreview />}
      trustCues={webmailTrustCues}
    >
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="email_address" className="block text-sm font-medium text-foreground">
              Email address
            </label>
            <input
              id="email_address"
              type="email"
              required
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              placeholder="you@yourdomain.com"
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/40 focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-foreground">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-foreground/40 focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      </div>
    </AuthLayout>
  );
}
