import type { ListParams } from './listParams';

/**
 * Every query key in the app, in one place.
 *
 * Everything that belongs to the signed-in mailbox sits under `['mb']`, so
 * one `removeQueries({ queryKey: qk.all })` forgets the whole account. The
 * account list is about the browser, not a mailbox, and lives outside it.
 */
export const qk = {
  all: ['mb'] as const,

  capabilities: ['mb', 'capabilities'] as const,
  settings: ['mb', 'settings'] as const,
  labels: ['mb', 'labels'] as const,
  scheduled: ['mb', 'scheduled'] as const,
  /** Compose autocomplete: saved cards, the directory and harvested addresses, merged. */
  suggestions: ['mb', 'suggestions'] as const,

  folders: ['mb', 'folders'] as const,
  /** Prefix of every message-list page. */
  lists: ['mb', 'list'] as const,
  list: (params: ListParams) => ['mb', 'list', params] as const,
  /** Prefix of every message body. */
  messages: ['mb', 'message'] as const,
  message: (id: string) => ['mb', 'message', id] as const,
  /** Prefix of every conversation. */
  threads: ['mb', 'thread'] as const,
  thread: (id: string) => ['mb', 'thread', id] as const,
  summary: (id: string) => ['mb', 'summary', id] as const,

  accounts: ['browser', 'accounts'] as const,
};
