import { useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronUp } from 'lucide-react';
import {
  canSchedule,
  defaultPickerTime,
  earliestPickable,
  fromDateTimeLocalValue,
  localZoneLabel,
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
  // Read when the menu opens, not during render: this component only ever
  // mounts behind a click, but reading the browser's clock during a render
  // Next may also run on the server is how a hydration mismatch starts.
  const [zone, setZone] = useState('');
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
    setCustom(toDateTimeLocalValue(defaultPickerTime(now)));
    setZone(localZoneLabel(now));
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
    // `flex items-stretch` so the caret half is exactly as tall as Send; the
    // wrapper carries no colour of its own because the split button's single
    // surface is painted by its parent (see WebmailCompose).
    <div className="relative flex items-stretch" ref={containerRef}>
      {/* Inset by my-2 so it reads as a divider WITHIN one control. A
          full-height rule runs into the rounded corners and makes the caret
          look like a second button stuck on the side. */}
      <span aria-hidden className="my-2 w-px bg-primary-foreground/30" />
      <button
        type="button"
        onClick={openMenu}
        disabled={disabled}
        className="px-2.5 flex items-center justify-center rounded-r-md transition-colors hover:bg-black/10 disabled:cursor-not-allowed"
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
          className="absolute bottom-full right-0 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-xl z-20 overflow-hidden"
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
                  {/* Neither side wraps: a label folding onto a second line
                      leaves one row taller than the others and the menu
                      reads as broken rather than as a list. */}
                  <span className="whitespace-nowrap">{preset.label}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
                    {preset.when}
                  </span>
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
              {/* Said out loud because a scheduling control gives nobody a
                  reason to assume it. The first question anyone asks of one
                  is "whose clock is that?" -- and the answer being "yours"
                  is only obvious once it is written down. */}
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : (
                <p className="text-xs text-gray-400">
                  Your local time{zone ? ` (${zone})` : ''}.
                </p>
              )}
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
