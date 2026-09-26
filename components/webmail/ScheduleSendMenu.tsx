'use client';

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
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';

type ScheduleSendMenuProps = {
  /** Called with the chosen instant. The caller sends it as an ISO string. */
  onSchedule: (at: Date) => void;
  disabled?: boolean;
};

/**
 * The caret beside Send. Opens UPWARD: the Send button sits on the bottom
 * edge of the compose window. Presets are recomputed when the menu opens,
 * not on mount, so a window left open overnight does not offer yesterday's
 * "tomorrow".
 */
export default function ScheduleSendMenu({ onSchedule, disabled }: ScheduleSendMenuProps) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [presets, setPresets] = useState(() => schedulePresets());
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault(); // handled: nothing further out closes on the same key
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
    <div className="relative flex items-stretch" ref={containerRef}>
      {/* Inset so it reads as a divider WITHIN one control. */}
      <span aria-hidden className="my-2 w-px bg-primary-foreground/30" />
      <button
        type="button"
        onClick={openMenu}
        disabled={disabled}
        className="flex items-center justify-center rounded-r-lg px-2 transition-colors hover:bg-black/10 disabled:cursor-not-allowed"
        title="Schedule send"
        aria-label="Schedule send"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ChevronUp size={15} />
      </button>

      {open && (
        <div
          role="menu"
          // Anchored to the caret's LEFT edge: the Send button sits at the
          // left of the footer, and a menu growing leftwards from it is
          // clipped by the window's own overflow.
          className="absolute bottom-full left-0 z-30 mb-2 w-80 max-w-[calc(100vw-2rem)] animate-fade-in overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-panel"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <CalendarClock size={15} className="text-muted-foreground" />
            <span className="text-[13px] font-semibold">Schedule send</span>
          </div>

          {!picking && (
            <div className="p-1">
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  role="menuitem"
                  type="button"
                  onClick={() => choose(preset.at)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-muted"
                >
                  <span className="whitespace-nowrap">{preset.label}</span>
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{preset.when}</span>
                </button>
              ))}
              <button
                role="menuitem"
                type="button"
                onClick={() => setPicking(true)}
                className="mt-1 w-full rounded-lg border-t border-border px-3 py-2 text-left text-[13px] hover:bg-muted"
              >
                Pick date &amp; time
              </button>
            </div>
          )}

          {picking && (
            <div className="space-y-3 p-4">
              <Input
                type="datetime-local"
                value={custom}
                min={earliestPickable()}
                onChange={(e) => {
                  setCustom(e.target.value);
                  setError(null);
                }}
              />
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Your local time{zone ? ` (${zone})` : ''}.</p>
              )}
              <div className="flex justify-end gap-2">
                <Button onClick={() => setPicking(false)}>Back</Button>
                <Button variant="primary" onClick={confirmCustom}>
                  Schedule
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
