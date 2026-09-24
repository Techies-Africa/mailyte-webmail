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

  accounts: ['browser', 'accounts'] as const,
};
