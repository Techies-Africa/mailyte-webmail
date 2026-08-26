import React from 'react';
import Link from 'next/link';
import { brand } from '@/lib/webmail/brand';
import { ShieldCheck, Activity, Code2 } from 'lucide-react';
import ThemeToggle from '@/components/auth/ThemeToggle';
import AuthBrandVisual from '@/components/auth/AuthBrandVisual';

interface TrustCue {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  description: string;
  footer?: React.ReactNode;
  // Everything below overrides one piece of the branded left panel --
  // added for /webmail/login (phase-11), which wants the same polished
  // shell but mailbox-holder-appropriate copy instead of the org-admin
  // "manage your email infrastructure" framing. All default to the
  // original org-admin content, so every existing call site is unchanged.
  panelHeadline?: React.ReactNode;
  panelDescription?: string;
  panelVisual?: React.ReactNode;
  trustCues?: TrustCue[];
}

const defaultTrustCues: TrustCue[] = [
  { icon: ShieldCheck, label: 'SPF · DKIM · DMARC' },
  { icon: Activity, label: '99.9% uptime' },
  { icon: Code2, label: 'SMTP + API' },
];

const defaultHeadline = (
  <>
    Email infrastructure
    <br />
    that just{' '}
    <span className="bg-gradient-to-r from-primary to-[#FF9900] bg-clip-text text-transparent">
      delivers.
    </span>
  </>
);

export default function AuthLayout({
  children,
  title,
  description,
  footer,
  panelHeadline = defaultHeadline,
  panelDescription = 'Verify your domain, configure SMTP, and monitor deliverability — all from one dashboard.',
  panelVisual,
  trustCues = defaultTrustCues,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Left — branded value panel (content centered as one balanced column) */}
      <div className="relative hidden overflow-hidden border-r border-border bg-card md:flex md:w-1/2 md:flex-col md:items-center md:justify-center md:p-12">
        {/* backdrop: soft gradient (light) + gold glow + subtle grid (dark) */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/10" />
          <div className="absolute -left-1/4 top-[-20%] h-[420px] w-[420px] rounded-full bg-primary/15 blur-3xl" />
          <div className="absolute inset-0 hidden bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_30%_20%,#000_50%,transparent_100%)] opacity-50 dark:block" />
        </div>

        {/* Logo — anchored top-left */}
        <Link href="/" className="absolute left-12 top-12 z-10 flex items-center gap-2">
          <span
                aria-hidden
                className="h-9 aspect-square rounded-lg bg-primary/15 text-primary grid place-items-center font-bold"
              >
                {brand.mark}
              </span>
          <span className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight text-foreground">
            {brand.name}
          </span>
        </Link>

        <div className="relative w-full max-w-lg">
          {/* Headline */}
          <h2 className="font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.1] tracking-tight text-foreground">
            {panelHeadline}
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{panelDescription}</p>

          {/* Animated visual */}
          <div className="mt-8">{panelVisual ?? <AuthBrandVisual />}</div>

          {/* Trust chips */}
          <div className="mt-8 flex flex-wrap gap-3">
            {trustCues.map((cue) => (
              <span
                key={cue.label}
                className="font-[family-name:var(--font-mono-preview)] inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs font-medium text-foreground/80 backdrop-blur-sm"
              >
                <cue.icon className="h-4 w-4 text-primary" />
                {cue.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right — auth form */}
      <div className="relative flex flex-1 flex-col justify-center px-4 py-10 md:px-12">
        <ThemeToggle className="absolute right-4 top-4 md:right-8 md:top-8" />

        <div className="mx-auto w-full max-w-md">
          {/* Mobile brand */}
          <Link href="/" className="mb-8 flex items-center gap-2 md:hidden">
            <span
                aria-hidden
                className="h-8 aspect-square rounded-lg bg-primary/15 text-primary grid place-items-center font-bold"
              >
                {brand.mark}
              </span>
            <span className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-foreground">
              {brand.name}
            </span>
          </Link>

          <div className="mb-6">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
            {children}
          </div>

          {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
