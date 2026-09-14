// The address book: saved contacts, backed by CardDAV.
//
// Distinct from the `contacts` in client.ts, which are compose autocomplete
// harvested from message headers. Those are derived from mail that already
// exists and cannot be edited; these are records a person chose to keep, and
// they sync to phones. Both feed the To field -- see app/page.tsx, where they
// are merged with saved entries ranked first.
//
// Mirrors lib/webmail/calendar.ts: every call can come back 401 when the
// session has expired, so callers pass onUnauthorized and the page redirects
// once, in one place.

import type { ApiResult } from './client';

export type ContactEmail = {
  address: string;
  /** HOME, WORK or OTHER. Null when the card did not say. */
  type: string | null;
};

export type ContactPhone = {
  number: string;
  /** CELL, HOME, WORK, FAX or OTHER. Null when the card did not say. */
  type: string | null;
};

export type Contact = {
  id: string;
  etag: string;
  book: string;
  read_only: boolean;
  uid: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  emails: ContactEmail[];
  phones: ContactPhone[];
  organization: string | null;
  title: string | null;
  address: string | null;
  note: string | null;
  birthday: string | null;
};

/** What the form collects. Everything optional; the server rejects a card
 *  with no name, address, number or organisation at all. */
export type ContactDraft = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  emails?: { address: string; type?: string | null }[];
  phones?: { number: string; type?: string | null }[];
  organization?: string | null;
  title?: string | null;
  address?: string | null;
  note?: string | null;
  birthday?: string | null;
};

export type AddressBook = {
  uri: string;
  name: string;
  description: string | null;
  /** True for a collection the server will refuse writes on, such as the
   *  company directory. Editing controls are hidden rather than failing. */
  read_only: boolean;
};

async function call<T>(
  input: string,
  init: RequestInit | undefined,
  onUnauthorized: () => void,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { success: false, message: 'Could not reach the mail server. Check your connection.' };
  }

  if (res.status === 401) {
    onUnauthorized();
    return { success: false, message: 'Not logged in' };
  }

  // 501 is "this deployment has no address book" -- a supported configuration,
  // not a fault. The nav entry is gated on the capability so this should be
  // unreachable, but saying it plainly beats a generic error.
  if (res.status === 501) {
    return { success: false, message: 'This server does not provide an address book.' };
  }

  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    type?: string;
    message?: string;
    msg?: string;
    data?: T;
  };

  const ok = data.success === true || data.type === 'success';
  if (!ok) {
    return {
      success: false,
      message: data.message ?? data.msg ?? 'Something went wrong. Please try again.',
    };
  }
  return { success: true, data: data.data as T };
}

export function listAddressBooks(onUnauthorized: () => void) {
  return call<AddressBook[]>('/api/webmail/address-book/books', undefined, onUnauthorized);
}

export function listContacts(onUnauthorized: () => void, book = 'default') {
  return call<Contact[]>(
    `/api/webmail/address-book/contacts?book=${encodeURIComponent(book)}`,
    undefined,
    onUnauthorized,
  );
}

export function createContact(
  draft: ContactDraft,
  onUnauthorized: () => void,
  book = 'default',
) {
  return call<{ id: string; etag: string }>(
    `/api/webmail/address-book/contacts?book=${encodeURIComponent(book)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    },
    onUnauthorized,
  );
}

export function updateContact(
  id: string,
  etag: string,
  draft: ContactDraft,
  onUnauthorized: () => void,
  book = 'default',
) {
  const query = new URLSearchParams({ book, etag });
  return call<{ id: string; etag: string }>(
    `/api/webmail/address-book/contacts/${encodeURIComponent(id)}?${query}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    },
    onUnauthorized,
  );
}

export function deleteContact(
  id: string,
  etag: string,
  onUnauthorized: () => void,
  book = 'default',
) {
  const query = new URLSearchParams({ book, etag });
  return call<null>(
    `/api/webmail/address-book/contacts/${encodeURIComponent(id)}?${query}`,
    { method: 'DELETE' },
    onUnauthorized,
  );
}

/** The name to show for a contact, falling back the way the server does. */
export function displayName(contact: Contact): string {
  if (contact.full_name?.trim()) return contact.full_name.trim();
  const joined = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  if (joined) return joined;
  return contact.emails[0]?.address ?? 'Unnamed contact';
}

/** The address to write to. The first one on the card, which is the order the
 *  card itself declares -- not an arbitrary pick. */
export function primaryEmail(contact: Contact): string | null {
  return contact.emails[0]?.address ?? null;
}
