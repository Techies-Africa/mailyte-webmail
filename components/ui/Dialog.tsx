'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import IconButton from './IconButton';

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Sits beside the title. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
  /** Turn off when the dialog is the one thing typing must not close. */
  closeOnBackdrop?: boolean;
};

const WIDTHS = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

const noSubscribe = () => () => {};

/**
 * A centred modal in the guide's card shape -- a sheet rising from the bottom
 * edge on a phone. Every dialog here -- confirm, move, AI writer, summary,
 * contact form -- is one of these, which is what makes them look like one
 * product rather than five.
 *
 * Rendered into <body>, not where it is declared. On a phone the reading pane
 * is `absolute z-20`, a stacking context: a dialog declared inside it could
 * never rise above z-20, so the minimized compose tabs covered its buttons.
 * React events still bubble through the component tree, not the DOM.
 *
 * The stack, bottom to top: rail and its backdrop 30/40 · floating panels
 * 40/50 (150/155 as a phone sheet) · compose tabs 140 · docked compose
 * windows 140+ · full-screen compose 200 · dialogs 205 · undo bar 210 ·
 * toasts 220. Dialogs sit above compose because compose opens its own
 * (Discard, Write with AI), and a page dialog now covers a docked window.
 */
export default function Dialog({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  width = 'md',
  closeOnBackdrop = true,
}: DialogProps) {
  // <body> exists only in the browser; the server renders nothing here.
  const onClient = useSyncExternalStore(noSubscribe, () => true, () => false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Handled: the drawer, the reply box and the shortcuts leave it alone.
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !onClient) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[205] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-shortcuts="off"
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card text-card-foreground shadow-window animate-rise sm:rounded-2xl ${WIDTHS[width]}`}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-5 py-3.5">
          {icon && <span className="text-primary">{icon}</span>}
          <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold tracking-tight">
            {title}
          </h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
