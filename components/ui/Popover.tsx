'use client';

import { useEffect } from 'react';

type FloatingPanelProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Where the panel sits. `anchor` renders it where placed (position: absolute inside a relative parent). */
  placement?: 'top-right' | 'anchor';
  width?: number;
  className?: string;
  label: string;
};

/**
 * A floating panel with a click-away backdrop and Escape to close.
 *
 * The redesign's calendar and contacts panels float over the reading pane at
 * the top right; the profile menu floats above its own button. Both need the
 * same two behaviours, so they share this rather than two copies of the same
 * event wiring.
 */
export default function FloatingPanel({
  open,
  onClose,
  children,
  placement = 'top-right',
  width = 300,
  className,
  label,
}: FloatingPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); // handled: the message behind stays open
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-40" />
      <div
        role="dialog"
        aria-label={label}
        style={{ width }}
        className={[
          'z-50 max-w-[calc(100vw-2rem)] animate-fade-in overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-panel',
          placement === 'top-right' ? 'fixed right-4 top-[58px]' : 'absolute',
          className ?? '',
        ].join(' ')}
      >
        {children}
      </div>
    </>
  );
}
