'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, X } from 'lucide-react';
import type { WebmailContact } from './types';
import Avatar from '@/components/ui/Avatar';
import { displayChip, extractEmail, splitRecipients } from './recipients';

/**
 * A recipient field as chips, with autocomplete (PRD C2).
 *
 * Each address is a chip that can be removed on its own and is marked when
 * it does not parse -- before the send, not after. The value stays a
 * comma-separated string at the boundary because that is what the compose
 * draft and the API already speak.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Characters that end an address as you type, the way every mail client does. */
const COMMIT_KEYS = [',', ';', 'Enter', 'Tab'];

type WebmailRecipientInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  contacts: WebmailContact[];
  autoFocus?: boolean;
  /** Rendered at the right-hand end of the row (the Cc/Bcc toggles). */
  trailing?: React.ReactNode;
  placeholder?: string;
};

export default function WebmailRecipientInput({
  label,
  value,
  onChange,
  contacts,
  autoFocus,
  trailing,
  placeholder,
}: WebmailRecipientInputProps) {
  const [pending, setPending] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div ref={containerRef} className="relative flex items-start gap-2 border-b border-border px-4 py-1.5">
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
              className={`my-1 inline-flex h-6 max-w-full items-center gap-1 rounded-full pl-0.5 pr-1 text-[12.5px] ${
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
              <span className="truncate px-0.5">{displayChip(chip)}</span>
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
