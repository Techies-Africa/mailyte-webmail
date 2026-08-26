import { useEffect, useMemo, useRef, useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import type { WebmailContact } from './types';

/**
 * A recipient field as chips, with autocomplete (PRD C2).
 *
 * The old field was a bare comma-separated text input, so a typo in the
 * middle of five addresses was invisible until the send failed, and there
 * was no way to remove one recipient without editing a string. Each address
 * here is a chip that can be removed on its own and is marked when it does
 * not parse -- before the send, not after.
 *
 * The value stays a comma-separated string at the boundary because that is
 * what the compose draft and the API already speak; the chips are how it is
 * edited, not a new data shape.
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
};

export function splitRecipients(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export default function WebmailRecipientInput({
  label,
  value,
  onChange,
  contacts,
  autoFocus,
  trailing,
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
    // deleting it outright -- a mistyped address should be fixable, not
    // retyped.
    if (e.key === 'Backspace' && pending === '' && chips.length > 0) {
      e.preventDefault();
      const last = chips[chips.length - 1];
      onChange(chips.slice(0, -1).join(', '));
      setPending(last);
    }
  };

  return (
    <div ref={containerRef} className="relative flex items-start border-b border-gray-200 dark:border-gray-700 px-3 py-1.5">
      <span className="text-sm text-gray-500 dark:text-gray-400 pt-1.5 w-10 flex-shrink-0">
        {label}
      </span>

      <div className="flex-1 flex flex-wrap items-center gap-1 min-h-[2rem]">
        {chips.map((chip, index) => {
          const email = extractEmail(chip);
          const valid = EMAIL_RE.test(email);
          return (
            <span
              key={`${chip}-${index}`}
              className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-sm max-w-full ${
                valid
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                  : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-700'
              }`}
              title={valid ? email : `${email} is not a valid email address`}
            >
              {!valid && <AlertCircle size={12} className="flex-shrink-0" />}
              <span className="truncate">{displayChip(chip)}</span>
              <button
                onClick={() => removeAt(index)}
                className="p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 flex-shrink-0"
                aria-label={`Remove ${email}`}
              >
                <X size={12} />
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
          className="flex-1 min-w-[10rem] bg-transparent text-sm py-1 focus:outline-none"
          aria-label={label}
          autoComplete="off"
        />
      </div>

      {trailing && <div className="pt-1 flex-shrink-0">{trailing}</div>}

      {open && suggestions.length > 0 && (
        <ul className="absolute left-12 top-full z-20 mt-1 w-80 max-w-[calc(100%-3rem)] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg overflow-hidden">
          {suggestions.map((contact, index) => (
            <li key={contact.email}>
              <button
                onMouseDown={(e) => {
                  // mousedown, not click: the input's onBlur fires first
                  // otherwise and commits the half-typed text instead.
                  e.preventDefault();
                  commit(contact.name ? `${contact.name} <${contact.email}>` : contact.email);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={`w-full text-left px-3 py-2 text-sm ${
                  index === highlight ? 'bg-gray-100 dark:bg-gray-700' : ''
                }`}
              >
                {contact.name && (
                  <span className="text-gray-900 dark:text-gray-100">{contact.name} </span>
                )}
                <span className="text-gray-500">{contact.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Ada Lovelace <ada@x.com>" -> "ada@x.com"; a bare address passes through. */
function extractEmail(entry: string): string {
  const match = entry.match(/<([^>]+)>/);
  return (match ? match[1] : entry).trim();
}

/** Prefer the display name on the chip; fall back to the address. */
function displayChip(entry: string): string {
  const named = entry.match(/^(.*?)\s*<[^>]+>$/);
  const name = named?.[1]?.trim().replace(/^["']|["']$/g, '');
  return name && name !== '' ? name : extractEmail(entry);
}
