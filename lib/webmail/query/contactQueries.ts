'use client';

import { useQuery } from '@tanstack/react-query';
import { listAddressBooks, listContacts } from '@/lib/webmail/contacts';
import { unwrap } from './errors';
import { useUnauthorizedHandler } from './session';

/**
 * The address book. Each book is cached on its own, so moving between books
 * -- or back to Contacts from anywhere -- shows a book seen before at once.
 */

export const contactKeys = {
  all: ['mb', 'contacts'] as const,
  books: ['mb', 'contacts', 'books'] as const,
  book: (uri: string) => ['mb', 'contacts', 'book', uri] as const,
};

export function useAddressBooks(enabled: boolean) {
  const onUnauthorized = useUnauthorizedHandler();
  return useQuery({
    queryKey: contactKeys.books,
    queryFn: async () => unwrap(await listAddressBooks(onUnauthorized)) ?? [],
    staleTime: 10 * 60_000,
    enabled,
  });
}

export function useBookContacts(book: string, enabled: boolean) {
  const onUnauthorized = useUnauthorizedHandler();
  return useQuery({
    queryKey: contactKeys.book(book),
    queryFn: async () => unwrap(await listContacts(onUnauthorized, book)) ?? [],
    staleTime: 5 * 60_000,
    enabled,
  });
}
