'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, X } from 'lucide-react';
import type { WebmailContact } from './types';
import Avatar from '@/components/ui/Avatar';
import Menu from '@/components/ui/Menu';
import { displayChip, extractEmail, splitRecipients, type RecipientField } from './recipients';

/**
 * A recipient field as chips, with autocomplete (PRD C2).
 *
 * Each address is a chip that can be removed on its own and is marked when
 * it does not parse -- before the send, not after. The value stays a
 * comma-separated string at the boundary because that is what the compose
 * draft and the API already speak.
 *
 * Given `dnd`, a chip also moves to another line (To, Cc, Bcc) of the same
 * message: dragged onto it, or by choosing "Move to ..." from the chip --
 * dragging does not work on a phone, and not everyone can drag.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Characters that end an address as you type, the way every mail client does. */
const COMMIT_KEYS = [',', ';', 'Enter', 'Tab'];

/**
 * The only thing a chip drag carries, under a type nothing else reads. Never
 * text/plain: a drop on the subject or the editor would paste the address.
 */
const CHIP_MIME = 'application/x-mailyte-recipient';
const LINES: RecipientField[] = ['to', 'cc', 'bcc'];
const LINE_NAME: Record<RecipientField, string> = { to: 'To', cc: 'Cc', bcc: 'Bcc' };

/** How a recipient line takes part in moving people between a message's lines. */
export type RecipientDnd = {
  /** Which line this input is. */
  field: RecipientField;
  /** The line a chip is being dragged from right now; null when none is. */
  dragFrom: RecipientField | null;
  onDragFrom: (field: RecipientField | null) => void;
  /** Take `entry` off `from` and put it on `to`. */
  move: (entry: string, from: RecipientField, to: RecipientField) => void;
};

/**
 * The drag state for ONE message's lines, kept by whoever owns the lines, so
 * a chip can only land on a line of its own message. Returns the `dnd` prop
 * for a given line. `onStart` runs as a drag begins: the host opens the lines
 * that are still hidden, so each can take a drop.
 */
export function useRecipientDnd(
  move: RecipientDnd['move'],
  onStart?: () => void,
): (field: RecipientField) => RecipientDnd {
  const [dragFrom, setDragFrom] = useState<RecipientField | null>(null);
  const onDragFrom = (from: RecipientField | null) => {
    setDragFrom(from);
    // A tick later, so the layout does not shift under the drag as it begins.
    if (from && onStart) window.setTimeout(onStart, 0);
  };
  return (field) => ({ field, dragFrom, onDragFrom, move });
}

type WebmailRecipientInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  contacts: WebmailContact[];
  autoFocus?: boolean;
  /** Rendered at the right-hand end of the row (the Cc/Bcc toggles). */
  trailing?: React.ReactNode;
  placeholder?: string;
  /** Lets chips move between this message's To, Cc and Bcc (useRecipientDnd). */
  dnd?: RecipientDnd;
};

export default function WebmailRecipientInput({
  label,
  value,
  onChange,
  contacts,
  autoFocus,
  trailing,
  placeholder,
  dnd,
}: WebmailRecipientInputProps) {
  const [pending, setPending] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // A chip from ANOTHER line of this message is being dragged: this line can take it.
  const taking = dnd && dnd.dragFrom !== null && dnd.dragFrom !== dnd.field ? dnd : null;
  const dropProps = taking
    ? {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropOver(true);
        },
        // dragleave fires for every child crossed; only leaving the row counts.
        onDragLeave: (e: React.DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false);
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDropOver(false);
          const entry = e.dataTransfer.getData(CHIP_MIME);
          if (entry && taking.dragFrom) taking.move(entry, taking.dragFrom, taking.field);
          // The source chip is gone by now, and a removed element hears no dragend.
          taking.onDragFrom(null);
        },
      }
    : undefined;

  const chips = useMemo(() => splitRecipients(value), [value]);

  const suggestions = useMemo(() => {
    const query = pending.trim().toLowerCase();
    if (query.length < 2) return [];
    const already = new Set(chips.map((c) => extractEmail(c).toLowerCase()));

    return contacts
      .filter(
        (c) =>
          !already.has(c.email.toLowerCase()) &&
          (c.email.toLowerCase().includes(query) || (c.name ?? '').toLowerCase().includes(query)),
      )
      .slice(0, 6);
  }, [pending, contacts, chips]);

  useEffect(() => setHighlight(0), [pending]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const commit = (raw: string) => {
    const entry = raw.trim().replace(/[,;]$/, '');
    if (entry === '') return;
    onChange([...chips, entry].join(', '));
    setPending('');
    setOpen(false);
  };

  const removeAt = (index: number) => {
    onChange(chips.filter((_, i) => i !== index).join(', '));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const picked = suggestions[highlight];
        commit(picked.name ? `${picked.name} <${picked.email}>` : picked.email);
        return;
      }
    }

    if (COMMIT_KEYS.includes(e.key)) {
      if (pending.trim() === '') return;
      e.preventDefault();
      commit(pending);
      return;
    }

    // Backspace on an empty input edits the previous chip rather than
    // deleting it outright.
    if (e.key === 'Backspace' && pending === '' && chips.length > 0) {
      e.preventDefault();
      const last = chips[chips.length - 1];
      onChange(chips.slice(0, -1).join(', '));
      setPending(last);
    }
  };

  return (
    <div
      ref={containerRef}
      {...dropProps}
      className={`relative flex items-start gap-2 border-b border-border px-4 py-1.5 ${
        taking ? (dropOver ? 'bg-primary/10 ring-1 ring-inset ring-primary/40' : 'bg-primary/5') : ''
      }`}
    >
      {/* Every line of this row is 32px -- a 24px chip with 4px above and
          below, or the input -- so the label and the Cc/Bcc toggles, centred
          in a 32px box, sit on the first line however many lines the chips
          wrap to. Left-aligned, hugging its own text: a fixed 8px (the row's
          gap-2) from its field, not a column's width away -- a short label
          like "To" sits right next to its chips instead of the ragged gap a
          shared right-aligned column left to its left. */}
      <span className="flex h-8 shrink-0 items-center font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1">
        {chips.map((chip, index) => {
          const email = extractEmail(chip);
          const valid = EMAIL_RE.test(email);
          return (
            <span
              key={`${chip}-${index}`}
              draggable={!!dnd}
              onDragStart={
                dnd
                  ? (e) => {
                      e.dataTransfer.setData(CHIP_MIME, chip);
                      e.dataTransfer.effectAllowed = 'move';
                      dnd.onDragFrom(dnd.field);
                    }
                  : undefined
              }
              // Not dropped on a line (Escape, or let go elsewhere): the chip is still here to hear it.
              onDragEnd={dnd ? () => dnd.onDragFrom(null) : undefined}
              className={`my-1 inline-flex h-6 max-w-full items-center gap-1 rounded-full pl-0.5 pr-1 text-[12.5px] ${
                dnd ? 'cursor-grab active:cursor-grabbing' : ''
              } ${
                valid
                  ? 'bg-muted text-foreground'
                  : 'bg-destructive/10 text-destructive ring-1 ring-destructive/30'
              }`}
              title={valid ? email : `${email} is not a valid email address`}
            >
              {valid ? (
                <Avatar name={displayChip(chip)} email={email} size={18} />
              ) : (
                <CircleAlert size={13} className="ml-1 shrink-0" />
              )}
              {dnd ? (
                <Menu
                  label={`Move ${email}`}
                  className="min-w-0"
                  // A span with a button role, not a <button>: Firefox does not start a
                  // drag of the chip from a real button inside it.
                  trigger={({ toggle, open: menuOpen }) => (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={toggle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle();
                        }
                      }}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      className="min-w-0 select-none truncate rounded px-0.5 text-left hover:underline"
                    >
                      {displayChip(chip)}
                    </span>
                  )}
                  items={LINES.filter((line) => line !== dnd.field).map((line) => ({
                    key: line,
                    label: `Move to ${LINE_NAME[line]}`,
                    onSelect: () => dnd.move(chip, dnd.field, line),
                  }))}
                />
              ) : (
                <span className="truncate px-0.5">{displayChip(chip)}</span>
              )}
              <button
                type="button"
                onClick={() => removeAt(index)}
                className="shrink-0 rounded-full p-0.5 hover:bg-foreground/10"
                aria-label={`Remove ${email}`}
              >
                <X size={11} />
              </button>
            </span>
          );
        })}

        <input
          autoFocus={autoFocus}
          value={pending}
          onChange={(e) => {
            setPending(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          // Anything half-typed when focus leaves is a recipient the user
          // meant to add; losing it silently is the worst option.
          onBlur={() => pending.trim() !== '' && commit(pending)}
          placeholder={chips.length === 0 ? placeholder : undefined}
          className="h-8 min-w-[8rem] flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
          aria-label={label}
          autoComplete="off"
        />
      </div>

      {trailing && <div className="flex h-8 shrink-0 items-center">{trailing}</div>}

      {open && suggestions.length > 0 && (
        <ul className="absolute left-12 top-full z-30 mt-1 w-80 max-w-[calc(100%-3rem)] overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-panel">
          {suggestions.map((contact, index) => (
            <li key={contact.email}>
              <button
                type="button"
                onMouseDown={(e) => {
                  // mousedown, not click: the input's onBlur fires first
                  // otherwise and commits the half-typed text instead.
                  e.preventDefault();
                  commit(contact.name ? `${contact.name} <${contact.email}>` : contact.email);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ${
                  index === highlight ? 'bg-muted' : ''
                }`}
              >
                <Avatar name={contact.name ?? contact.email} email={contact.email} size={24} />
                <span className="min-w-0 flex-1">
                  {contact.name && <span className="block truncate font-semibold text-foreground">{contact.name}</span>}
                  <span className="block truncate font-mono text-[11.5px] text-muted-foreground">{contact.email}</span>
                </span>
                {contact.source && (
                  <span className="shrink-0 text-[10.5px] text-muted-foreground">
                    {contact.source === 'saved' ? 'saved' : 'colleague'}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Cc and Bcc switches at the end of a To row: the compose window's and the inline reply's. */
export function CcBccToggles({
  showCc,
  showBcc,
  onToggleCc,
  onToggleBcc,
}: {
  showCc: boolean;
  showBcc: boolean;
  onToggleCc: () => void;
  onToggleBcc: () => void;
}) {
  return (
    <div className="flex gap-2.5 pr-1">
      <button
        type="button"
        onClick={onToggleCc}
        className={`text-[11px] font-bold ${showCc ? 'text-muted-foreground' : 'text-primary'}`}
      >
        Cc
      </button>
      <button
        type="button"
        onClick={onToggleBcc}
        className={`text-[11px] font-bold ${showBcc ? 'text-muted-foreground' : 'text-primary'}`}
      >
        Bcc
      </button>
    </div>
  );
}
