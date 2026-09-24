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
 *
 * On a phone a top-right panel is a sheet rising from the bottom edge over a
 * dimmed page instead: a 300px card pinned to the right of a 360px screen
 * sat on top of the open menu drawer, with its left edge floating in the
 * middle of nothing. The sheet sits above the minimized compose tabs (z-140)
 * and below a full-screen compose window (z-200). The width is a CSS
 * variable rather than an inline width, which would beat the sheet's.
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

  const sheet = placement === 'top-right';

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={sheet ? 'fixed inset-0 z-40 max-md:z-[150] max-md:bg-black/50' : 'fixed inset-0 z-40'}
      />
      <div
        role="dialog"
        aria-label={label}
        style={{ '--panel-w': `${width}px` } as React.CSSProperties}
        className={[
          'overflow-hidden border border-border bg-popover text-popover-foreground shadow-panel',
          sheet
            ? [
                'fixed z-50',
                'max-md:inset-x-0 max-md:bottom-0 max-md:z-[155] max-md:max-h-[85dvh] max-md:animate-rise max-md:overflow-y-auto max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0',
                'md:right-4 md:top-[58px] md:w-[var(--panel-w)] md:max-w-[calc(100vw-2rem)] md:animate-fade-in md:rounded-2xl',
              ].join(' ')
            : 'absolute z-50 w-[var(--panel-w)] max-w-[calc(100vw-2rem)] animate-fade-in rounded-2xl',
          className ?? '',
        ].join(' ')}
      >
        {children}
      </div>
    </>
  );
}
