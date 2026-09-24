'use client';

import { useEffect } from 'react';
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

/**
 * A centred modal in the guide's card shape. Every dialog here -- confirm,
 * move, AI writer, summary, contact form -- is one of these, which is what
 * makes them look like one product rather than five.
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
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-shortcuts="off"
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card text-card-foreground shadow-window animate-rise sm:rounded-2xl ${WIDTHS[width]}`}
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
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
