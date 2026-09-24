'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import type { WebmailContact } from '../types';
import FloatingPanel from '@/components/ui/Popover';
import Avatar from '@/components/ui/Avatar';

type ContactsPanelProps = {
  open: boolean;
  onClose: () => void;
  /** The merged suggestion list: saved cards first, then the directory. */
  contacts: WebmailContact[];
  onWriteTo: (email: string, name: string | null) => void;
};

const LIMIT = 40;

/**
 * The floating contacts panel: search the address books, click to write.
 *
 * Reads the same merged list Compose autocompletes from, so a person who
 * completes in the To field is findable here and vice versa. Harvested
 * header addresses are left out -- this panel is the address book, not the
 * history.
 */
export default function ContactsPanel({ open, onClose, contacts, onWriteTo }: ContactsPanelProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);

  const book = useMemo(() => contacts.filter((c) => c.source), [contacts]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? book.filter(
          (c) => c.email.toLowerCase().includes(needle) || (c.name ?? '').toLowerCase().includes(needle),
        )
      : book;
    return pool.slice(0, LIMIT);
  }, [book, query]);

  return (
    <FloatingPanel open={open} onClose={onClose} label="Contacts" width={300}>
      <div className="border-b border-border px-4 pb-3 pt-3.5">
        <div className="mb-2.5 font-display text-[13.5px] font-bold">Contacts</div>
        <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5">
          <Search size={12} strokeWidth={2.2} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts…"
            aria-label="Search contacts"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70"
          />
        </div>
      </div>

      <div className="thin-scroll max-h-[260px] overflow-y-auto p-1.5">
        {book.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
            No saved contacts yet. Add people in the address book and they appear here.
          </p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">Nothing matches that.</p>
        ) : (
          shown.map((contact) => (
            <button
              key={contact.email}
              type="button"
              onClick={() => onWriteTo(contact.email, contact.name)}
              title={`Write to ${contact.name ?? contact.email}`}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
            >
              <Avatar name={contact.name ?? contact.email} email={contact.email} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold">{contact.name ?? contact.email}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{contact.email}</span>
              </span>
              {contact.source === 'directory' && (
                <span className="shrink-0 text-[10.5px] text-muted-foreground">colleague</span>
              )}
            </button>
          ))
        )}
      </div>

      <a
        href="/address-book"
        className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12.5px] font-semibold text-primary hover:bg-muted"
      >
        Open address book
        <ExternalLink size={13} />
      </a>
    </FloatingPanel>
  );
}
