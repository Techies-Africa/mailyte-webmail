'use client';

import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

type MenuProps = {
  /** The control that opens the menu. Receives whether it is open. */
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  /** Opens upward, for controls on the bottom edge of the screen. */
  direction?: 'down' | 'up';
  label: string;
};

/**
 * A small action menu: trigger + list, closing on outside click, Escape or
 * a pick. Used for the folder "…" menu, the reading pane's overflow, and the
 * bulk "More" menu, which previously each carried their own copy of the same
 * outside-click effect.
 */
export default function Menu({ trigger, items, align = 'left', direction = 'down', label }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={[
            'absolute z-30 min-w-[210px] max-w-[320px] animate-fade-in rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-panel',
            align === 'right' ? 'right-0' : 'left-0',
            direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          ].join(' ')}
        >
          {items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={[
                'flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-[12.5px] font-medium disabled:opacity-40',
                item.tone === 'danger'
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'text-foreground hover:bg-muted',
              ].join(' ')}
            >
              {item.icon && <span className="text-muted-foreground">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
