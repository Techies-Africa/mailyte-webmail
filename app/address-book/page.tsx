'use client';

/**
 * The address book.
 *
 * A front door for CardDAV, which has been running since the calendar shipped
 * with nothing able to see it. Contacts saved here sync to whatever the person
 * has already connected -- iPhone, Android via DAVx5, Apple Contacts -- because
 * they are written through the same server those clients read.
 *
 * Deliberately not the same thing as the addresses Compose suggests. Those are
 * harvested from message headers and cover everyone you have ever written to;
 * these are the people you chose to keep, and only these leave the browser.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookUser, Mail, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import {
  createContact,
  deleteContact,
  displayName,
  listAddressBooks,
  listContacts,
  primaryEmail,
  updateContact,
  type AddressBook,
  type Contact,
  type ContactDraft,
} from '@/lib/webmail/contacts';

const EMPTY_DRAFT: ContactDraft = {
  first_name: '',
  last_name: '',
  emails: [{ address: '', type: 'WORK' }],
  phones: [{ number: '', type: 'CELL' }],
  organization: '',
  title: '',
  address: '',
  note: '',
};

function draftFrom(contact: Contact): ContactDraft {
  return {
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
    full_name: contact.full_name ?? '',
    emails: contact.emails.length ? contact.emails.map((e) => ({ ...e })) : [{ address: '', type: 'WORK' }],
    phones: contact.phones.length ? contact.phones.map((p) => ({ ...p })) : [{ number: '', type: 'CELL' }],
    organization: contact.organization ?? '',
    title: contact.title ?? '',
    address: contact.address ?? '',
    note: contact.note ?? '',
    birthday: contact.birthday ?? '',
  };
}

export default function AddressBookPage() {
  const router = useRouter();
  const onUnauthorized = useCallback(() => router.replace('/login'), [router]);

  const [supported, setSupported] = useState<boolean | null>(null);
  const [books, setBooks] = useState<AddressBook[]>([]);
  const [activeBook, setActiveBook] = useState('default');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [editing, setEditing] = useState<Contact | null>(null);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const currentBook = books.find((b) => b.uri === activeBook);
  const readOnly = currentBook?.read_only ?? false;

  // Capability first, exactly as the calendar page does: an optional feature
  // stays hidden until the server says it exists, rather than flashing on and
  // disappearing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/webmail/capabilities', { cache: 'no-store' });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        data?: { capabilities?: Record<string, boolean> };
      };
      if (!cancelled) setSupported(Boolean(body.data?.capabilities?.contacts));
    })();
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized]);

  useEffect(() => {
    if (supported !== true) return;
    (async () => {
      const res = await listAddressBooks(onUnauthorized);
      if (res.success) setBooks(res.data);
    })();
  }, [supported, onUnauthorized]);

  const load = useCallback(async () => {
    const res = await listContacts(onUnauthorized, activeBook);
    if (res.success) {
      setContacts(res.data);
      setBanner(null);
    } else {
      setBanner(res.message);
    }
    setLoading(false);
  }, [activeBook, onUnauthorized]);

  useEffect(() => {
    if (supported !== true) return;
    void load();
  }, [supported, load]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((c) => {
      const haystack = [
        displayName(c),
        c.organization ?? '',
        ...c.emails.map((e) => e.address),
        ...c.phones.map((p) => p.number),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [contacts, query]);

  async function save() {
    if (!draft) return;
    setSaving(true);

    // Blank rows are how a form with "add another" always ends up; they are
    // not the user saying "save an empty address".
    const cleaned: ContactDraft = {
      ...draft,
      emails: (draft.emails ?? []).filter((e) => e.address.trim()),
      phones: (draft.phones ?? []).filter((p) => p.number.trim()),
    };

    const res = editing
      ? await updateContact(editing.id, editing.etag, cleaned, onUnauthorized, activeBook)
      : await createContact(cleaned, onUnauthorized, activeBook);

    setSaving(false);
    if (!res.success) {
      setBanner(res.message);
      return;
    }
    setDraft(null);
    setEditing(null);
    await load();
  }

  async function remove(contact: Contact) {
    const res = await deleteContact(contact.id, contact.etag, onUnauthorized, activeBook);
    setConfirmDelete(null);
    if (!res.success) {
      setBanner(res.message);
      return;
    }
    await load();
  }

  if (supported === null) {
    return <div className="p-8 text-sm text-neutral-500">Loading&hellip;</div>;
  }

  if (supported === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <BookUser size={28} className="text-neutral-400" />
        <h1 className="text-base font-medium">No address book on this server</h1>
        <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
          This mail server does not run a contacts service, so there is nothing
          to show here. Mail is unaffected.
        </p>
        <a href="/" className="text-sm text-primary underline">
          Back to mail
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <a
          href="/"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Mail size={16} /> Mail
        </a>

        <div className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-800" />

        <h1 className="text-sm font-medium">Contacts</h1>

        {books.length > 1 && (
          <select
            value={activeBook}
            onChange={(e) => {
              setActiveBook(e.target.value);
              setLoading(true);
            }}
            aria-label="Address book"
            className="ml-2 rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
          >
            {books.map((book) => (
              <option key={book.uri} value={book.uri}>
                {book.name}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contacts"
              className="w-44 rounded border border-neutral-200 bg-transparent py-1 pl-7 pr-2 text-sm dark:border-neutral-700"
            />
          </div>

          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft({ ...EMPTY_DRAFT });
              }}
              className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus size={15} /> Add contact
            </button>
          )}
        </div>
      </header>

      {banner && (
        <p className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          {banner}
        </p>
      )}

      {readOnly && (
        <p className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          <Users size={13} />
          {/* The server's own description, not a copy of it. This used to say
              "Everyone in your organisation", which stopped being true when
              the directory narrowed to the signed-in domain -- and was
              already misleading for an organisation holding several. Whose
              addresses these are is the server's answer to give. */}
          {currentBook?.description || 'Kept up to date automatically.'} Not
          editable here.
        </p>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-sm text-neutral-500">Loading&hellip;</p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <BookUser size={26} className="text-neutral-300 dark:text-neutral-600" />
            <p className="text-sm font-medium">
              {query ? 'Nothing matches that' : 'No contacts yet'}
            </p>
            {!query && !readOnly && (
              <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
                Contacts you save here appear in Compose and sync to your phone
                if you have connected it.
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {shown.map((contact) => (
              <li key={contact.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{displayName(contact)}</p>
                  {(contact.title || contact.organization) && (
                    <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {[contact.title, contact.organization].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">
                    {contact.emails.map((email) => (
                      <span key={email.address} className="truncate">
                        {email.address}
                        {email.type && (
                          <span className="ml-1 text-neutral-400">{email.type.toLowerCase()}</span>
                        )}
                      </span>
                    ))}
                    {contact.phones.map((phone) => (
                      <span key={phone.number} className="truncate tabular-nums">
                        {phone.number}
                        {phone.type && (
                          <span className="ml-1 text-neutral-400">{phone.type.toLowerCase()}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {primaryEmail(contact) && (
                    <a
                      href={`/?compose=${encodeURIComponent(primaryEmail(contact) as string)}`}
                      title={`Write to ${displayName(contact)}`}
                      className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <Mail size={15} />
                    </a>
                  )}
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(contact);
                          setDraft(draftFrom(contact));
                        }}
                        aria-label={`Edit ${displayName(contact)}`}
                        className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <Pencil size={15} />
                      </button>
                      {confirmDelete === contact.id ? (
                        <span className="flex items-center gap-1 text-xs">
                          <button
                            type="button"
                            onClick={() => remove(contact)}
                            className="rounded bg-rose-600 px-2 py-1 text-white"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            className="underline"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(contact.id)}
                          aria-label={`Delete ${displayName(contact)}`}
                          className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {draft && (
        <ContactForm
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onClose={() => {
            setDraft(null);
            setEditing(null);
          }}
          saving={saving}
          isEdit={Boolean(editing)}
        />
      )}
    </div>
  );
}

function ContactForm({
  draft,
  setDraft,
  onSave,
  onClose,
  saving,
  isEdit,
}: {
  draft: ContactDraft;
  setDraft: (d: ContactDraft) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  isEdit: boolean;
}) {
  const emails = draft.emails ?? [];
  const phones = draft.phones ?? [];

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl dark:bg-neutral-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">{isEdit ? 'Edit contact' : 'New contact'}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={draft.first_name ?? ''}
              onChange={(e) => setDraft({ ...draft, first_name: e.target.value })}
              placeholder="First name"
              className="rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
            />
            <input
              value={draft.last_name ?? ''}
              onChange={(e) => setDraft({ ...draft, last_name: e.target.value })}
              placeholder="Last name"
              className="rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
            />
          </div>

          {emails.map((email, index) => (
            <div key={`email-${index}`} className="flex gap-2">
              <input
                type="email"
                value={email.address}
                onChange={(e) => {
                  const next = [...emails];
                  next[index] = { ...next[index], address: e.target.value };
                  setDraft({ ...draft, emails: next });
                }}
                placeholder="Email"
                className="flex-1 rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
              />
              <select
                value={email.type ?? 'WORK'}
                onChange={(e) => {
                  const next = [...emails];
                  next[index] = { ...next[index], type: e.target.value };
                  setDraft({ ...draft, emails: next });
                }}
                aria-label="Email type"
                className="rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
              >
                <option value="WORK">Work</option>
                <option value="HOME">Home</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDraft({ ...draft, emails: [...emails, { address: '', type: 'WORK' }] })}
            className="text-xs text-primary underline"
          >
            Add another email
          </button>

          {phones.map((phone, index) => (
            <div key={`phone-${index}`} className="flex gap-2">
              <input
                value={phone.number}
                onChange={(e) => {
                  const next = [...phones];
                  next[index] = { ...next[index], number: e.target.value };
                  setDraft({ ...draft, phones: next });
                }}
                placeholder="Phone"
                className="flex-1 rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
              />
              <select
                value={phone.type ?? 'CELL'}
                onChange={(e) => {
                  const next = [...phones];
                  next[index] = { ...next[index], type: e.target.value };
                  setDraft({ ...draft, phones: next });
                }}
                aria-label="Phone type"
                className="rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
              >
                <option value="CELL">Mobile</option>
                <option value="WORK">Work</option>
                <option value="HOME">Home</option>
                <option value="FAX">Fax</option>
              </select>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDraft({ ...draft, phones: [...phones, { number: '', type: 'CELL' }] })}
            className="text-xs text-primary underline"
          >
            Add another phone
          </button>

          <div className="grid grid-cols-2 gap-2">
            <input
              value={draft.organization ?? ''}
              onChange={(e) => setDraft({ ...draft, organization: e.target.value })}
              placeholder="Company"
              className="rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
            />
            <input
              value={draft.title ?? ''}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Job title"
              className="rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
            />
          </div>

          <input
            value={draft.address ?? ''}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            placeholder="Address"
            className="w-full rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
          />

          <textarea
            value={draft.note ?? ''}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="Notes"
            rows={2}
            className="w-full rounded border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
