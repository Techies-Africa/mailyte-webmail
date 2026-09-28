'use client';

import { useEffect, useState } from 'react';
import { HardDrive, X } from 'lucide-react';
import { useSettings } from '@/lib/webmail/query/accountQueries';
import { HELD_DAYS, formatMb, storageLevel } from '@/lib/webmail/storage';

const DISMISSED_KEY = 'mailyte.webmail.storageBannerDismissed';

/**
 * "Almost full" and "full", above the message list.
 *
 * The mail server enforces the mailbox's quota at delivery: once it is full,
 * new mail is held and, after ten days, returned to the sender. Usage was only
 * shown in Settings, so a mailbox could fill without anyone noticing
 * (2026-09-28). The figures are the server's own (IMAP QUOTA, through
 * settings.storage), and the lines match the emails the holder gets.
 *
 * At 80% it can be dismissed for the rest of the session; full, it stays.
 */
export default function StorageBanner() {
  const storage = useSettings().data?.storage;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISSED_KEY) === '1');
    } catch {
      // No session storage (private window, blocked site data): just show it.
    }
  }, []);

  if (!storage) return null;

  const level = storageLevel(storage.percentage, storage.quotaMb);
  if (level === 'ok' || (level === 'almost-full' && dismissed)) return null;

  const figures = `${formatMb(storage.usedMb)} of ${formatMb(storage.quotaMb)}`;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Dismissed for this page only, then.
    }
  };

  if (level === 'full') {
    return (
      <div
        role="alert"
        className="flex shrink-0 items-start gap-2.5 border-b border-border bg-destructive/10 px-3.5 py-2 text-[12px] text-destructive"
      >
        <HardDrive className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          <strong className="font-semibold">Your mailbox is full</strong> ({figures}). New mail is being held and is
          returned to the sender after {HELD_DAYS} days. Delete old messages, then empty Trash, to make room.
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex shrink-0 items-start gap-2.5 border-b border-border bg-warning/[0.1] px-3.5 py-2 text-[12px] text-warning"
    >
      <HardDrive className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">Your mailbox is {storage.percentage}% full</strong> ({figures}). Delete old
        messages with large attachments, then empty Trash, before new mail stops arriving.
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss storage warning"
        className="shrink-0 rounded p-0.5 hover:bg-warning/[0.12]"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
