import { useEffect, useState } from 'react';
import { Undo2, Send } from 'lucide-react';

/**
 * The undo-send toast (PRD C4).
 *
 * Counts down the real remaining time rather than showing a spinner, so
 * "how long have I got" is answerable at a glance. When it reaches zero the
 * toast disappears because the message has actually gone -- there is no
 * lingering "sent!" state offering an Undo that would no longer work.
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
  // The full window, captured once, so the bar measures against a fixed
  // denominator instead of against itself.
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
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[min(28rem,calc(100vw-2rem))] rounded-lg bg-gray-900 text-white shadow-xl overflow-hidden"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Send size={16} className="flex-shrink-0 text-gray-300" />
        <span className="flex-1 min-w-0 text-sm">
          <span className="text-gray-300">Sending </span>
          <span className="font-medium truncate">{subject}</span>
          <span className="text-gray-400"> — {seconds}s</span>
        </span>
        <button
          onClick={onUndo}
          className="flex items-center gap-1.5 px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-sm font-medium flex-shrink-0"
        >
          <Undo2 size={14} />
          Undo
        </button>
      </div>
      <div
        className="h-1 bg-primary transition-[width] duration-200 ease-linear"
        style={{ width: `${(remaining / total) * 100}%` }}
      />
    </div>
  );
}
