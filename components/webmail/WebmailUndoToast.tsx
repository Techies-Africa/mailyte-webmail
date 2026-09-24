import { useEffect, useState } from 'react';
import { Undo2, Send } from 'lucide-react';

/**
 * The undo-send toast (PRD C4).
 *
 * Counts down the real remaining time, so "how long have I got" is
 * answerable at a glance. When it reaches zero the toast disappears because
 * the message has actually gone -- there is no lingering "sent!" state
 * offering an Undo that would no longer work.
 */
export default function WebmailUndoToast({
  subject,
  until,
  onUndo,
}: {
  subject: string;
  /** Epoch ms at which the message is handed to the mail server. */
  until: number;
  onUndo: () => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, until - Date.now()));
  const [total] = useState(() => Math.max(1, until - Date.now()));

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, until - Date.now()));
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [until]);

  const seconds = Math.ceil(remaining / 1000);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-[210] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 animate-toast-in overflow-hidden rounded-2xl bg-toast text-white shadow-toast"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Send size={15} className="shrink-0 text-white/60" />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          <span className="text-white/60">Sending </span>
          <span className="font-semibold">{subject}</span>
          <span className="text-white/50"> · {seconds}s</span>
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
        >
          <Undo2 size={13} />
          Undo
        </button>
      </div>
      <div
        className="h-[3px] bg-primary transition-[width] duration-200 ease-linear"
        style={{ width: `${(remaining / total) * 100}%` }}
      />
    </div>
  );
}
