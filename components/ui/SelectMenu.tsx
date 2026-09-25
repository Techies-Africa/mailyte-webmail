'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Tag } from './Pill';
import { useDismiss } from './useDismiss';

export type SelectMenuOption = {
  value: string;
  label: string;
  /** A second, muted line: what the calendar or book is for. */
  description?: string | null;
  /** A colour dot or an icon. Shown in the row, and in the trigger for `button`. */
  leading?: React.ReactNode;
  /** Shows a "Read-only" tag. Still choosable: you can look at what you cannot change. */
  readOnly?: boolean;
};

type SelectMenuProps = {
  /** The accessible name of the trigger and of the list ("Calendar", "Address book"). */
  label: string;
  /** The mono eyebrow above the rows ("Calendars"). Decoration; the list is named by `label`. */
  heading?: string;
  options: SelectMenuOption[];
  value: string;
  onChange: (value: string) => void;
  /** A toolbar control, or the page title itself made pressable. */
  appearance?: 'button' | 'heading';
  /**
   * Below `sm`, the trigger shows only the leading slot and the chevron. The
   * calendar's second header row fits a 375px phone only without the name;
   * the name stays in the trigger for screen readers.
   */
  compact?: boolean;
  /** The side the panel prefers. It is nudged back on screen either way. */
  align?: 'left' | 'right';
  /** Shown when `value` matches no option. */
  placeholder?: string;
  /** Layout only (a margin, a flex share), on the root. */
  className?: string;
};

/** The panel's width: `w-72`. Fixed, so it can be placed before it is drawn. */
const PANEL_WIDTH = 288;
/** The clear space kept between the panel and the screen edge: `max-w-[calc(100vw-1.5rem)]`. */
const VIEWPORT_GAP = 12;
/** How long typed letters keep adding to one search before it starts over. */
const TYPEAHEAD_MS = 500;

/*
 * The Button secondary sm look, restated rather than reused: Button's
 * shrink-0 and justify-center cannot be overridden from outside (Tailwind
 * emits utilities of one group in its own order, not the order of the class
 * list), and `heading` cannot be a Button at all. No outline-none: the global
 * :focus-visible ring gives keyboard focus a ring and mouse focus none.
 */
const TRIGGER = {
  button:
    'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted',
  heading:
    '-ml-1.5 inline-flex h-8 min-w-0 items-center gap-1 rounded-md px-1.5 font-display text-[15px] font-bold tracking-tight text-foreground transition-colors hover:bg-foreground/[0.06]',
};

/** The trigger while its list is open. bg-muted sorts after bg-card, so it wins. */
const OPEN = { button: 'bg-muted', heading: 'bg-foreground/[0.06]' };

const NAME = {
  button: 'max-w-[9rem] truncate sm:max-w-[12rem]',
  // sr-only rather than hidden: a phone's screen reader still hears which calendar this is.
  compact: 'sr-only sm:not-sr-only sm:max-w-[12rem] sm:truncate',
  heading: 'max-w-[13rem] truncate sm:max-w-[20rem]',
};

/**
 * Where the panel's left edge goes, relative to the root: under the trigger
 * on the preferred side, then pulled back so it keeps VIEWPORT_GAP clear of
 * both screen edges. Worked out when the list opens (and on resize) rather
 * than in a layout effect: the width is fixed, so nothing needs measuring
 * after the panel is drawn.
 */
function panelOffset(root: HTMLElement, trigger: HTMLElement, align: 'left' | 'right'): number {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * VIEWPORT_GAP);
  const wanted = align === 'right' ? rect.right - width : rect.left;
  const x = Math.max(VIEWPORT_GAP, Math.min(wanted, window.innerWidth - VIEWPORT_GAP - width));
  return Math.round(x - root.getBoundingClientRect().left);
}

/**
 * A choice between a few named things -- which calendar, which address book
 * -- drawn as a toolbar button or as the page title, with a list that can
 * say more than a native <select> can: a colour, a description, a
 * "Read-only" tag.
 *
 * The form Select was doing this job in the calendar and contacts headers
 * and looked broken there: the browser's own chevron, a purple ring that
 * stayed after every mouse pick, clipped 14px text in a 32px box, a dark
 * hole in dark mode.
 *
 * The WAI-ARIA "select-only combobox": focus never leaves the trigger (a
 * <button> with role combobox, which ARIA in HTML allows), and the
 * highlighted row is announced through aria-activedescendant -- which role
 * button would ignore. Because focus never moves, it never has to be put
 * back.
 *
 * Keys: arrows, Home/End and PageUp/PageDown move; typing jumps to a name;
 * Enter or Space chooses; Escape closes and changes nothing; so does Tab,
 * unlike the pattern's "Tab commits" -- a stray Tab should not switch which
 * calendar is on screen.
 */
export default function SelectMenu({
  label,
  heading,
  options,
  value,
  onChange,
  appearance = 'button',
  compact = false,
  align = 'left',
  placeholder,
  className,
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /**
   * What last moved the highlight. Null right after a click opens the list,
   * so the chosen row shows as chosen rather than also as hovered; `keys`
   * adds the inset ring, the list's own :focus-visible.
   */
  const [highlight, setHighlight] = useState<'keys' | 'pointer' | null>(null);
  const [offset, setOffset] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex === -1 ? null : options[selectedIndex];
  // A list that shrinks while open cannot leave the highlight past its end.
  const current = Math.max(0, Math.min(active, options.length - 1));

  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  function openAt(index: number, via: 'keys' | null) {
    if (rootRef.current && triggerRef.current) setOffset(panelOffset(rootRef.current, triggerRef.current, align));
    setActive(index);
    setHighlight(via);
    setOpen(true);
  }

  function moveTo(index: number) {
    setActive(Math.max(0, Math.min(index, options.length - 1)));
    setHighlight('keys');
  }

  function choose(index: number) {
    setOpen(false);
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
  }

  /**
   * The row typed letters point at, or -1. One letter pressed again and
   * again steps through the rows starting with it; letters typed together
   * find the first row whose name starts with all of them.
   */
  function typeahead(key: string, from: number): number {
    const now = Date.now();
    const text = now - typed.current.at > TYPEAHEAD_MS ? key : typed.current.text + key;
    typed.current = { text, at: now };
    const needle = text.toLowerCase();
    const repeated = [...needle].every((letter) => letter === needle[0]);
    const search = repeated ? needle[0] : needle;
    // A fresh or repeated letter looks past the current row; a longer word may still be it.
    const start = repeated ? from + 1 : from;
    for (let step = 0; step < options.length; step += 1) {
      const index = (start + step) % options.length;
      if (options[index].label.toLowerCase().startsWith(search)) return index;
    }
    return -1;
  }

  // Keep the highlighted row in view. The list's own scrollTop only, so a
  // row near the edge never scrolls the page under the panel.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const row = list?.children[current] as HTMLElement | undefined;
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [open, current]);

  // A window resized (or a phone turned) while the list is open moves it
  // back on screen. The setter runs in the listener, not the effect body.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (rootRef.current && triggerRef.current) setOffset(panelOffset(rootRef.current, triggerRef.current, align));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, align]);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (options.length === 0) return;
    const last = options.length - 1;
    const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openAt(Math.max(selectedIndex, 0), 'keys');
      } else if (event.key === 'Home') {
        event.preventDefault();
        openAt(0, 'keys');
      } else if (event.key === 'End') {
        event.preventDefault();
        openAt(last, 'keys');
      } else if (printable) {
        event.preventDefault();
        const match = typeahead(event.key, Math.max(selectedIndex, 0));
        openAt(match === -1 ? Math.max(selectedIndex, 0) : match, 'keys');
      }
      return;
    }

    // A Space inside a word being typed is part of the word.
    const typing = Date.now() - typed.current.at <= TYPEAHEAD_MS && typed.current.text !== '';
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveTo(current + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        // Alt+Up is the pattern's "choose and close".
        if (event.altKey) choose(current);
        else moveTo(current - 1);
        return;
      case 'Home':
      case 'PageUp':
        event.preventDefault();
        moveTo(0);
        return;
      case 'End':
      case 'PageDown':
        event.preventDefault();
        moveTo(last);
        return;
      case 'Enter':
        event.preventDefault();
        choose(current);
        return;
      case ' ':
        if (typing) break;
        event.preventDefault();
        choose(current);
        return;
      case 'Escape':
        // Handled here, so the dialog or drawer around the page stays open.
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      case 'Tab':
        // Closes without choosing, and focus moves on as usual.
        close();
        return;
    }
    if (printable) {
      event.preventDefault();
      const match = typeahead(event.key, current);
      if (match !== -1) moveTo(match);
    }
  }

  return (
    <div ref={rootRef} className={['relative inline-flex min-w-0', className ?? ''].join(' ')}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options.length > 0 ? optionId(current) : undefined}
        onClick={() => {
          // Safari does not focus a button on click, and the arrow keys and
          // close-on-blur both need focus here.
          triggerRef.current?.focus();
          if (open) close();
          else openAt(Math.max(selectedIndex, 0), null);
        }}
        onKeyDown={onKeyDown}
        // Firefox clicks a button on Space's keyup, which would open the list
        // again straight after Space chose from it.
        onKeyUp={(event) => {
          if (event.key === ' ') event.preventDefault();
        }}
        onBlur={close}
        className={[TRIGGER[appearance], open ? OPEN[appearance] : ''].join(' ')}
      >
        {appearance === 'button' && selected?.leading}
        <span className={NAME[appearance === 'heading' ? 'heading' : compact ? 'compact' : 'button']}>
          {selected?.label ?? placeholder ?? label}
        </span>
        <ChevronDown
          aria-hidden
          size={appearance === 'heading' ? 14 : 13}
          strokeWidth={2.2}
          className={['shrink-0 text-muted-foreground transition-transform', open ? 'rotate-180' : ''].join(' ')}
        />
      </button>

      {open && (
        <div
          style={{ left: offset }}
          // Pressing a row must not take focus from the trigger: the blur
          // would close the list before the click landed.
          onMouseDown={(event) => event.preventDefault()}
          className="absolute top-full z-30 mt-1.5 w-72 max-w-[calc(100vw-1.5rem)] animate-fade-in overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-panel"
        >
          {heading && (
            <div
              aria-hidden
              className="px-3 pb-0.5 pt-2.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
            >
              {heading}
            </div>
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            // relative: the rows' offsetTop is measured from the list, for the scroll above.
            className="thin-scroll relative max-h-[min(22rem,calc(100dvh-8rem))] overflow-y-auto p-1"
          >
            {options.map((option, index) => {
              const isSelected = index === selectedIndex;
              const isActive = index === current && highlight !== null;
              return (
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => choose(index)}
                  onMouseMove={() => {
                    if (index !== current || highlight !== 'pointer') {
                      setActive(index);
                      setHighlight('pointer');
                    }
                  }}
                  className={[
                    'flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2',
                    isSelected ? (isActive ? 'bg-selection-strong' : 'bg-selection') : isActive ? 'bg-muted' : '',
                    isActive && highlight === 'keys' ? 'ring-2 ring-inset ring-ring/70' : '',
                  ].join(' ')}
                >
                  <span className="flex h-[18px] w-3.5 shrink-0 items-center justify-center text-muted-foreground">
                    {option.leading}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={[
                          'truncate text-[12.5px] leading-[18px] text-foreground',
                          isSelected ? 'font-semibold' : 'font-medium',
                        ].join(' ')}
                      >
                        {option.label}
                      </span>
                      {option.readOnly && <Tag className="shrink-0">Read-only</Tag>}
                    </span>
                    {option.description && (
                      <span className="mt-0.5 line-clamp-2 break-words text-[11.5px] leading-snug text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {/* The label stays foreground on the tint; primary text on
                      bg-selection is weak in dark mode, so only the tick is. */}
                  <Check
                    aria-hidden
                    size={13}
                    strokeWidth={2.4}
                    className={['mt-[2.5px] shrink-0 text-primary', isSelected ? '' : 'invisible'].join(' ')}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * A calendar's colour as a dot. The colour comes from the server, through
 * style, so no colour value lives in the source; the faint inner ring keeps
 * a white calendar visible on a white panel. No colour draws a muted dot.
 */
export function Swatch({ colour }: { colour: string | null }) {
  return (
    <span
      aria-hidden
      className={[
        'h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10',
        colour ? '' : 'bg-muted-foreground/40',
      ].join(' ')}
      style={colour ? { backgroundColor: colour } : undefined}
    />
  );
}
