'use client';

/**
 * The address book.
 *
 * A front door for CardDAV. Contacts saved here sync to whatever the person
 * has already connected -- iPhone, Android via DAVx5, Apple Contacts --
 * because they are written through the same server those clients read.
 *
 * Not the same thing as the addresses Compose suggests: those are harvested
 * from message headers; these are the people you chose to keep.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookUser, Mail, Menu as MenuIcon, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import PageShell, { useOpenPageMenu } from '@/components/webmail/shell/PageShell';
import { useCapabilities } from '@/lib/webmail/query/accountQueries';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import IconButton from '@/components/ui/IconButton';
import { Input, Label, Select, Textarea } from '@/components/ui/Field';
import ConfirmModal from '@/components/webmail/modals/ConfirmModal';
import {
  createContact,
  deleteContact,
  displayName,
  primaryEmail,
  updateContact,
  type AddressBook,
  type Contact,
  type ContactDraft,
} from '@/lib/webmail/contacts';
import { contactKeys, useAddressBooks, useBookContacts } from '@/lib/webmail/query/contactQueries';
import { qk } from '@/lib/webmail/query/keys';
import { useUnauthorizedHandler } from '@/lib/webmail/query/session';

const NO_BOOKS: AddressBook[] = [];
const NO_CONTACTS: Contact[] = [];

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
  // Null until the server has answered once; cached after that, so a revisit gates at once.
  const capabilities = useCapabilities().data;
  const supported = capabilities ? capabilities.capabilities?.contacts === true : null;
  return (
    <PageShell current="contacts">
      <AddressBookScreen supported={supported} />
    </PageShell>
  );
}

function AddressBookScreen({ supported }: { supported: boolean | null }) {
  const openMenu = useOpenPageMenu();
  const queryClient = useQueryClient();
  const onUnauthorized = useUnauthorizedHandler();

  const books = useAddressBooks(supported === true).data ?? NO_BOOKS;
  const [activeBook, setActiveBook] = useState('default');
  const contactsResult = useBookContacts(activeBook, supported === true);
  const contacts = contactsResult.data ?? NO_CONTACTS;
  // Only a book never opened before shows "Loading".
  const loading = contactsResult.isPending;
  /** What went wrong with the last thing the person did. */
  const [actionError, setBanner] = useState<string | null>(null);
  const banner = actionError ?? (contactsResult.isError ? contactsResult.error.message : null);
  const [query, setQuery] = useState('');

  const [editing, setEditing] = useState<Contact | null>(null);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Contact | null>(null);

  const currentBook = books.find((b) => b.uri === activeBook);
  const readOnly = currentBook?.read_only ?? false;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((c) => {
      const haystack = [displayName(c), c.organization ?? '', ...c.emails.map((e) => e.address), ...c.phones.map((p) => p.number)]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [contacts, query]);

  /** This book changed: reload it behind the list, and compose's suggestions with it. */
  const refreshBook = (book: string) => {
    void queryClient.invalidateQueries({ queryKey: contactKeys.book(book) });
    void queryClient.invalidateQueries({ queryKey: qk.suggestions });
  };

  /**
   * Saving waits for the server, in the dialog: it assigns the id and the
   * etag, and it can refuse. A refusal is shown in the dialog, where the
   * person is looking, rather than on the page behind it.
   */
  async function save() {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
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
      setFormError(res.message);
      return;
    }
    setDraft(null);
    setEditing(null);
    setBanner(null);
    refreshBook(activeBook);
  }

  /** Deleting (after the confirm) takes the card off the list at once; a refusal puts it back. */
  function remove(contact: Contact) {
    const book = activeBook;
    const key = contactKeys.book(book);
    const before = queryClient.getQueryData<Contact[]>(key);
    queryClient.setQueryData<Contact[]>(key, (list) => list?.filter((c) => c.id !== contact.id));
    void (async () => {
      const res = await deleteContact(contact.id, contact.etag, onUnauthorized, book);
      if (!res.success) {
        queryClient.setQueryData(key, before);
        setBanner(`Couldn't delete ${displayName(contact)}: ${res.message}`);
      }
      refreshBook(book);
    })();
  }

  if (supported === null) {
    return <div className="p-8 text-sm text-muted-foreground">Loading&hellip;</div>;
  }

  if (supported === false) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <BookUser size={28} className="text-muted-foreground" />
        <h1 className="font-display text-base font-semibold">No address book on this server</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This mail server does not run a contacts service, so there is nothing to show here. Mail is unaffected.
        </p>
        <Link href="/" className="text-sm font-semibold text-primary underline">
          Back to mail
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-card">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-5">
        <IconButton label="Menu" size="sm" onClick={openMenu} className="md:hidden">
          <MenuIcon size={15} />
        </IconButton>
        <h1 className="font-display text-[15px] font-bold tracking-tight">Contacts</h1>
        {books.length > 1 && (
          <Select
            value={activeBook}
            onChange={(e) => setActiveBook(e.target.value)}
            aria-label="Address book"
            className="ml-1 h-8 !w-auto py-0 text-[12.5px]"
          >
            {books.map((book) => (
              <option key={book.uri} value={book.uri}>
                {book.name}
              </option>
            ))}
          </Select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5">
            <Search size={12} strokeWidth={2.2} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contacts"
              aria-label="Search contacts"
              className="w-36 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70 sm:w-48"
            />
          </div>
          {!readOnly && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={13} />}
              onClick={() => {
                setEditing(null);
                setDraft({ ...EMPTY_DRAFT });
              }}
            >
              Add contact
            </Button>
          )}
        </div>
      </header>

      {banner && <p className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">{banner}</p>}

      {readOnly && (
        <p className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
          <Users size={13} />
          {currentBook?.description || 'Kept up to date automatically.'} Not editable here.
        </p>
      )}

      <div className="thin-scroll flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading&hellip;</p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <div className="mb-2 flex h-[72px] w-[72px] items-center justify-center rounded-[20px] bg-primary/10 text-primary">
              <BookUser size={30} strokeWidth={1.6} />
            </div>
            <p className="font-display text-[14.5px] font-bold">{query ? 'Nothing matches that' : 'No contacts yet'}</p>
            {!query && !readOnly && (
              <p className="max-w-sm text-[12.5px] text-muted-foreground">
                Contacts you save here appear in Compose and sync to your phone if you have connected it.
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((contact) => (
              <li key={contact.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 sm:px-5">
                <Avatar name={displayName(contact)} email={primaryEmail(contact) ?? displayName(contact)} size={34} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{displayName(contact)}</p>
                  {(contact.title || contact.organization) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {[contact.title, contact.organization].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {contact.emails.map((email) => (
                      <span key={email.address} className="truncate font-mono">
                        {email.address}
                        {email.type && <span className="ml-1 font-sans text-muted-foreground/70">{email.type.toLowerCase()}</span>}
                      </span>
                    ))}
                    {contact.phones.map((phone) => (
                      <span key={phone.number} className="truncate tabular-nums">
                        {phone.number}
                        {phone.type && <span className="ml-1 text-muted-foreground/70">{phone.type.toLowerCase()}</span>}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  {primaryEmail(contact) && (
                    <Link
                      href={`/?compose=${encodeURIComponent(primaryEmail(contact) as string)}`}
                      title={`Write to ${displayName(contact)}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
                    >
                      <Mail size={14} />
                    </Link>
                  )}
                  {!readOnly && (
                    <>
                      <IconButton
                        label={`Edit ${displayName(contact)}`}
                        size="sm"
                        onClick={() => {
                          setEditing(contact);
                          setDraft(draftFrom(contact));
                        }}
                      >
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton label={`Delete ${displayName(contact)}`} size="sm" tone="danger" onClick={() => setConfirmDelete(contact)}>
                        <Trash2 size={14} />
                      </IconButton>
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
            setFormError(null);
          }}
          saving={saving}
          error={formError}
          isEdit={Boolean(editing)}
        />
      )}

      <ConfirmModal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) remove(confirmDelete);
        }}
        icon={<Trash2 size={18} />}
        tone="danger"
        title="Delete contact"
        body={
          <>
            <span className="font-semibold text-foreground">{confirmDelete ? displayName(confirmDelete) : ''}</span> will be
            removed from this address book and from every device that syncs it.
          </>
        }
        confirmLabel="Delete"
      />
    </div>
  );
}

function ContactForm({
  draft,
  setDraft,
  onSave,
  onClose,
  saving,
  error,
  isEdit,
}: {
  draft: ContactDraft;
  setDraft: (d: ContactDraft) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
  isEdit: boolean;
}) {
  const emails = draft.emails ?? [];
  const phones = draft.phones ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={isEdit ? 'Edit contact' : 'New contact'}
      icon={<BookUser size={16} />}
      width="md"
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="contact-first">First name</Label>
            <Input id="contact-first" value={draft.first_name ?? ''} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="contact-last">Last name</Label>
            <Input id="contact-last" value={draft.last_name ?? ''} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} />
          </div>
        </div>

        <div>
          <Label>Email</Label>
          <div className="space-y-2">
            {emails.map((email, index) => (
              <div key={`email-${index}`} className="flex gap-2">
                <Input
                  type="email"
                  value={email.address}
                  onChange={(e) => {
                    const next = [...emails];
                    next[index] = { ...next[index], address: e.target.value };
                    setDraft({ ...draft, emails: next });
                  }}
                  placeholder="name@example.com"
                  className="font-mono text-[13px]"
                />
                <Select
                  value={email.type ?? 'WORK'}
                  onChange={(e) => {
                    const next = [...emails];
                    next[index] = { ...next[index], type: e.target.value };
                    setDraft({ ...draft, emails: next });
                  }}
                  aria-label="Email type"
                  className="w-28"
                >
                  <option value="WORK">Work</option>
                  <option value="HOME">Home</option>
                  <option value="OTHER">Other</option>
                </Select>
                {emails.length > 1 && (
                  <IconButton label="Remove email" size="md" onClick={() => setDraft({ ...draft, emails: emails.filter((_, i) => i !== index) })}>
                    <X size={13} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setDraft({ ...draft, emails: [...emails, { address: '', type: 'WORK' }] })}
            className="mt-2 text-xs font-semibold text-primary hover:underline"
          >
            Add another email
          </button>
        </div>

        <div>
          <Label>Phone</Label>
          <div className="space-y-2">
            {phones.map((phone, index) => (
              <div key={`phone-${index}`} className="flex gap-2">
                <Input
                  value={phone.number}
                  onChange={(e) => {
                    const next = [...phones];
                    next[index] = { ...next[index], number: e.target.value };
                    setDraft({ ...draft, phones: next });
                  }}
                  placeholder="+234 …"
                  className="tabular-nums"
                />
                <Select
                  value={phone.type ?? 'CELL'}
                  onChange={(e) => {
                    const next = [...phones];
                    next[index] = { ...next[index], type: e.target.value };
                    setDraft({ ...draft, phones: next });
                  }}
                  aria-label="Phone type"
                  className="w-28"
                >
                  <option value="CELL">Mobile</option>
                  <option value="WORK">Work</option>
                  <option value="HOME">Home</option>
                  <option value="FAX">Fax</option>
                </Select>
                {phones.length > 1 && (
                  <IconButton label="Remove phone" size="md" onClick={() => setDraft({ ...draft, phones: phones.filter((_, i) => i !== index) })}>
                    <X size={13} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setDraft({ ...draft, phones: [...phones, { number: '', type: 'CELL' }] })}
            className="mt-2 text-xs font-semibold text-primary hover:underline"
          >
            Add another phone
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="contact-org">Company</Label>
            <Input id="contact-org" value={draft.organization ?? ''} onChange={(e) => setDraft({ ...draft, organization: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="contact-title">Job title</Label>
            <Input id="contact-title" value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
        </div>

        <div>
          <Label htmlFor="contact-address">Address</Label>
          <Input id="contact-address" value={draft.address ?? ''} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
        </div>

        <div>
          <Label htmlFor="contact-note">Notes</Label>
          <Textarea id="contact-note" value={draft.note ?? ''} onChange={(e) => setDraft({ ...draft, note: e.target.value })} rows={2} />
        </div>
      </div>
    </Dialog>
  );
}
