'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WebmailContact } from '@/components/webmail/types';
import { toContact, toSettings } from '@/lib/webmail/adapters';
import {
  getCapabilities,
  getSettings,
  listAccounts,
  listContacts,
  listLabels,
  listScheduled,
  type ScheduledMessage,
} from '@/lib/webmail/client';
import { displayName as contactName, listAllContacts } from '@/lib/webmail/contacts';
import { ApiError, unwrap } from './errors';
import { qk } from './keys';
import { accountChanged, useUnauthorizedHandler } from './session';

/**
 * Data that belongs to the mailbox as a whole rather than to one screen.
 *
 * Each of these used to be fetched by every screen that needed it, on every
 * visit -- capabilities by the inbox and again by the calendar and address
 * book shells, settings by three of them. One cached copy now serves all.
 */

const EMPTY_LABELS: string[] = [];
const EMPTY_SCHEDULED: ScheduledMessage[] = [];

/** What this server can do, and whose mailbox it is. */
export function useCapabilities() {
  const onUnauthorized = useUnauthorizedHandler();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: qk.capabilities,
    queryFn: async () => {
      const data = unwrap(await getCapabilities(onUnauthorized));
      // Someone else's mailbox now answers: nothing cached here is theirs.
      if (data?.email_address && accountChanged(data.email_address)) {
        queryClient.clear();
        window.location.assign('/');
      }
      return data;
    },
    // Rechecked when the tab comes back, which is when a session is most
    // likely to have changed underneath it.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useSettings() {
  const onUnauthorized = useUnauthorizedHandler();
  return useQuery({
    queryKey: qk.settings,
    queryFn: async () => {
      const data = unwrap(await getSettings(onUnauthorized));
      if (!data) throw new ApiError('Settings could not be loaded.');
      return data;
    },
    select: toSettings,
    staleTime: 5 * 60_000,
  });
}

/** Every mailbox signed in on this browser. Changes only through a full reload. */
export function useAccounts() {
  return useQuery({
    queryKey: qk.accounts,
    queryFn: async () => unwrap(await listAccounts())?.accounts ?? [],
    staleTime: Infinity,
  });
}

function selectLabels(data: { labels?: string[] } | null): string[] {
  return Array.isArray(data?.labels) ? data.labels : EMPTY_LABELS;
}

/** Every label in use. Quiet on failure: an older server has no labels. */
export function useLabels() {
  const onUnauthorized = useUnauthorizedHandler();
  const query = useQuery({
    queryKey: qk.labels,
    queryFn: async () => unwrap(await listLabels(onUnauthorized)),
    select: selectLabels,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return query.data ?? EMPTY_LABELS;
}

/** When each message in the Scheduled folder is due. */
export function useScheduled() {
  const onUnauthorized = useUnauthorizedHandler();
  const query = useQuery({
    queryKey: qk.scheduled,
    queryFn: async () => unwrap(await listScheduled(onUnauthorized))?.messages ?? EMPTY_SCHEDULED,
    staleTime: 60_000,
  });
  return query.data ?? EMPTY_SCHEDULED;
}

/**
 * Compose autocomplete. Three sources, merged in this order and de-duplicated
 * by address: saved cards, the directory, then everyone harvested from
 * headers. A curated record outranks a generated one; the harvested list is
 * the only one that knows who you actually write to, so it is never dropped.
 */
async function loadSuggestions(onUnauthorized: () => void): Promise<WebmailContact[]> {
  const [harvested, books] = await Promise.all([listContacts(onUnauthorized), listAllContacts(onUnauthorized)]);

  const fromBooks = (wanted: 'saved' | 'directory') =>
    books
      .filter((entry) => (entry.book.read_only ? 'directory' : 'saved') === wanted)
      .flatMap((entry) =>
        entry.contacts.flatMap((contact) =>
          contact.emails.map((email) => ({ name: contactName(contact), email: email.address, source: wanted })),
        ),
      )
      .filter((entry) => entry.email);

  const ranked: WebmailContact[] = [
    ...fromBooks('saved'),
    ...fromBooks('directory'),
    ...(harvested.success && Array.isArray(harvested.data) ? harvested.data.map(toContact) : []),
  ];

  const seen = new Set<string>();
  return ranked.filter((entry) => {
    const key = entry.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const EMPTY_SUGGESTIONS: WebmailContact[] = [];

export function useSuggestions() {
  const onUnauthorized = useUnauthorizedHandler();
  const query = useQuery({
    queryKey: qk.suggestions,
    queryFn: () => loadSuggestions(onUnauthorized),
    staleTime: 10 * 60_000,
  });
  return query.data ?? EMPTY_SUGGESTIONS;
}
