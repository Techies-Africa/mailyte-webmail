import { useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronUp } from 'lucide-react';
import {
  canSchedule,
  earliestPickable,
  fromDateTimeLocalValue,
  schedulePresets,
  toDateTimeLocalValue,
} from '@/lib/webmail/scheduleTimes';

type ScheduleSendMenuProps = {
  /** Called with the chosen instant. The caller sends it as an ISO string. */
  onSchedule: (at: Date) => void;
  disabled?: boolean;
};

/**
 * The caret beside Send.
 *
 * Opens UPWARD: the Send button sits on the bottom edge of the compose
 * window, and a menu dropping down would open off the bottom of a maximised
 * compose or a phone screen.
 *
 * The presets are recomputed when the menu opens, not when the component
 * mounts -- a compose window left open overnight would otherwise still be
 * offering yesterday's "tomorrow".
 */
export default function ScheduleSendMenu({ onSchedule, disabled }: ScheduleSendMenuProps) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [presets, setPresets] = useState(() => schedulePresets());
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setPicking(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setPicking(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openMenu = () => {
    const now = new Date();
    setPresets(schedulePresets(now));
    setCustom(toDateTimeLocalValue(new Date(now.getTime() + 60 * 60_000)));
    setError(null);
    setPicking(false);
    setOpen((v) => !v);
  };

  const choose = (at: Date) => {
    setOpen(false);
    setPicking(false);
    onSchedule(at);
  };

  const confirmCustom = () => {
    const at = fromDateTimeLocalValue(custom);
    if (!at) {
      setError('Pick a date and time.');
      return;
    }
    if (!canSchedule(at)) {
      setError('Pick a time a little further ahead.');
      return;
    }
    choose(at);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={openMenu}
        disabled={disabled}
        className="px-2 py-2 bg-primary text-primary-foreground rounded-r-md border-l border-primary-foreground/20 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Schedule send"
        aria-label="Schedule send"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ChevronUp size={16} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 mb-2 w-72 rounded-lg border border-border bg-card shadow-xl z-20 overflow-hidden"
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <CalendarClock size={16} className="text-gray-400" />
            <span className="text-sm font-medium">Schedule send</span>
          </div>

          {!picking && (
            <>
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  role="menuitem"
                  type="button"
                  onClick={() => choose(preset.at)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted"
                >
                  <span>{preset.label}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{preset.when}</span>
                </button>
              ))}
              <button
                role="menuitem"
                type="button"
                onClick={() => setPicking(true)}
                className="w-full px-4 py-2.5 text-left text-sm border-t border-border hover:bg-muted"
              >
                Pick date &amp; time
              </button>
            </>
          )}

          {picking && (
            <div className="p-4 space-y-3">
              <input
                type="datetime-local"
                value={custom}
                min={earliestPickable()}
                onChange={(e) => {
                  setCustom(e.target.value);
                  setError(null);
                }}
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPicking(false)}
                  className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={confirmCustom}
                  className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Schedule
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
