import React from 'react';
import { KeyRound, Lock, Server } from 'lucide-react';
import ThemeToggle from '@/components/auth/ThemeToggle';
import BrandMark, { BrandLockup } from '@/components/brand/BrandMark';
import { brand } from '@/lib/webmail/brand';

interface TrustCue {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  description: string;
  footer?: React.ReactNode;
  panelHeadline?: React.ReactNode;
  panelDescription?: string;
  trustCues?: TrustCue[];
}

/**
 * Statements about what this software does, not figures about how well.
 * The previous panel animated an invented delivery chart; a sign-in screen
 * has no business quoting numbers it did not measure.
 */
const defaultTrustCues: TrustCue[] = [
  { icon: Server, label: 'Reads and sends over your own mail server' },
  { icon: Lock, label: 'Remote images blocked until you say' },
  { icon: KeyRound, label: 'Two-factor sign-in, if you turn it on' },
];

const defaultHeadline = (
  <>
    Your mail.
    <br />
    Your server.
    <br />
    <span className="text-brand-gradient">Your rules.</span>
  </>
);

/**
 * The sign-in shell: an ink panel carrying the brand on the left, the form
 * on the right. The panel is the same colour as the app's rail, so the
 * screen after sign-in continues it rather than switching to something else.
 */
export default function AuthLayout({
  children,
  title,
  description,
  footer,
  panelHeadline = defaultHeadline,
  panelDescription = 'Read, search and send real mail from any browser. Nothing to install.',
  trustCues = defaultTrustCues,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <div className="relative hidden overflow-hidden bg-sidebar text-white md:flex md:w-[46%] md:flex-col md:p-12 lg:p-14">
        {/* A single brand-gradient sweep, per the guide: hero panels only. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
        <div
          aria-hidden
          className="bg-brand-gradient pointer-events-none absolute -bottom-24 -right-24 h-[420px] w-[420px] rounded-full opacity-[0.16] blur-3xl"
        />

        <a href="/login" className="relative z-10 flex w-full max-w-lg shrink-0 items-center">
          <BrandLockup height={30} tone="dark" />
        </a>

        <div className="relative z-10 my-auto w-full max-w-lg">
          <h2 className="font-display text-[42px] font-bold leading-[1.05] tracking-[-0.028em]">{panelHeadline}</h2>
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-white/60">{panelDescription}</p>

          <ul className="mt-10 space-y-3">
            {trustCues.map((cue) => (
              <li key={cue.label} className="flex items-center gap-3 text-[13.5px] text-white/80">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.08]">
                  <cue.icon className="h-4 w-4 text-white/80" />
                </span>
                {cue.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 flex items-center gap-3 text-[12.5px] text-white/40">
          <BrandMark height={18} tone="dark" className="opacity-70" />
          <span>{brand.name === 'Mailyte' ? 'A Techies Africa product' : `Powered by Mailyte`}</span>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col justify-center bg-pane px-4 py-10 md:px-12">
        <ThemeToggle className="absolute right-4 top-4 md:right-8 md:top-8" />

        <div className="mx-auto w-full max-w-md">
          <a href="/login" className="mb-8 flex items-center md:hidden">
            <BrandLockup height={26} tone="light" className="dark:hidden" />
            <BrandLockup height={26} tone="dark" className="hidden dark:block" />
          </a>

          <div className="mb-6">
            <h1 className="font-display text-[28px] font-bold tracking-tight text-foreground">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">{children}</div>

          {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
