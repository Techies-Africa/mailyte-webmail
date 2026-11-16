'use client';

import { useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { useSettings } from '@/lib/webmail/query/accountQueries';
import { signOut } from '@/lib/webmail/client';

function minutesLeft(endsAt: string): number {
  const ms = new Date(endsAt).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 60_000)) : 0;
}

/**
 * Shown only to Mailyte staff, in a support session: a mailbox opened from
 * the console to look into a problem the holder reported. The session lasts
 * an hour at most; this is the reminder, and the way out. It floats over
 * the page rather than taking a row, so the screen staff see is laid out
 * exactly as the holder's.
 *
 * The holder never sees it: their own sessions carry no support_session.
 */
export default function SupportSessionBanner() {
  const settings = useSettings().data;
  const session = settings?.supportSession ?? null;
  const email = settings?.emailAddress ?? '';
  const [left, setLeft] = useState<number | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!session) return;
    const tick = () => setLeft(minutesLeft(session.endsAt));
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [session]);

  if (!session) return null;

  const end = async () => {
    setEnding(true);
    await signOut(false);
  };

  return (
    <div
      role="status"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
      className="fixed left-1/2 z-50 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-border bg-popover py-1.5 pl-3.5 pr-1.5 text-[12px] text-popover-foreground shadow-lg"
    >
      <LifeBuoy className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 truncate">
        <strong className="font-semibold">Support session</strong> in {email}
        {left !== null && <> · ends in {left} min</>}. Everything you do here is real.
      </span>
      <button
        type="button"
        onClick={end}
        disabled={ending}
        className="shrink-0 rounded-full bg-primary px-2.5 py-0.5 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {ending ? 'Ending…' : 'End session'}
      </button>
    </div>
  );
}
