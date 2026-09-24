'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Info } from 'lucide-react';

/**
 * Bottom-centre confirmations.
 *
 * The old banner under the toolbar had one appearance -- amber, with a
 * Dismiss button -- and turned every "Message sent" into a small chore. The
 * redesign uses a dark pill that says its piece and goes. Warnings and errors
 * stay longer and can be dismissed, because "the Sent copy is still being
 * filed" is worth reading and "that did not send" is worth acting on.
 */

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export type ToastCloseReason = 'timeout' | 'dismissed' | 'action' | 'replaced';

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds. Defaults per tone; 0 keeps it until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /**
   * Called once when the toast goes, with why. An Undo toast uses it to know
   * its window is over: a timeout, a dismissal or being replaced by the next
   * toast all mean "go ahead"; only 'action' means the person took it back.
   */
  onClose?: (reason: ToastCloseReason) => void;
}

interface ToastEntry extends Required<Pick<ToastOptions, 'tone'>> {
  id: number;
  text: string;
  action?: ToastOptions['action'];
}

type ToastApi = {
  toast: (text: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 2600,
  info: 3200,
  warning: 7000,
  error: 8000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const closers = useRef(new Map<number, (reason: ToastCloseReason) => void>());

  const close = useCallback((id: number, reason: ToastCloseReason) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    const onClose = closers.current.get(id);
    closers.current.delete(id);
    setToasts((current) => current.filter((t) => t.id !== id));
    onClose?.(reason);
  }, []);

  const dismiss = useCallback((id: number) => close(id, 'dismissed'), [close]);

  const toast = useCallback(
    (text: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      const tone = options.tone ?? 'success';
      // One at a time: a stack of confirmations reads as a fault. Whatever
      // was showing is closed first, so its onClose hears that it was replaced.
      for (const previous of [...closers.current.keys()]) close(previous, 'replaced');
      if (options.onClose) closers.current.set(id, options.onClose);
      setToasts([{ id, text, tone, action: options.action }]);
      const duration = options.duration ?? DEFAULT_DURATION[tone];
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => close(id, 'timeout'), duration),
        );
      }
      return id;
    },
    [close],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[220]">
        {toasts.map((entry) => (
          <div
            key={entry.id}
            role="status"
            className="pointer-events-auto absolute bottom-0 left-1/2 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-toast-in items-center gap-2.5 whitespace-nowrap rounded-full bg-toast px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-toast"
          >
            <ToastIcon tone={entry.tone} />
            <span className="truncate">{entry.text}</span>
            {entry.action && (
              <button
                type="button"
                onClick={() => {
                  entry.action?.onClick();
                  close(entry.id, 'action');
                }}
                className="ml-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold hover:bg-white/20"
              >
                {entry.action.label}
              </button>
            )}
            {(entry.tone === 'warning' || entry.tone === 'error') && (
              <button
                type="button"
                onClick={() => dismiss(entry.id)}
                aria-label="Dismiss"
                className="ml-1 text-white/60 hover:text-white"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') return <Check size={14} strokeWidth={2.6} className="text-[hsl(142,60%,55%)]" />;
  if (tone === 'info') return <Info size={14} className="text-secondary" />;
  return (
    <AlertTriangle
      size={14}
      className={tone === 'warning' ? 'text-[hsl(38,85%,60%)]' : 'text-[hsl(0,80%,68%)]'}
    />
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return api;
}
