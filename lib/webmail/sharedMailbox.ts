import type { SharedMailbox } from '@/lib/webmail/client';

/**
 * Shared mailboxes arrive as IMAP folders under Dovecot's shared namespace,
 * `Shared/<address>/<path>`, and the server puts the same prefix on the ids of
 * the messages in them (`Shared/<address>/INBOX:12`).
 */
export const SHARED_PREFIX = 'Shared/';

/** The shared address in a folder name or message id; null for the person's own mailbox. */
export function sharedAddressOf(idOrFolder: string | null | undefined): string | null {
  if (!idOrFolder || !idOrFolder.startsWith(SHARED_PREFIX)) return null;
  const rest = idOrFolder.slice(SHARED_PREFIX.length);
  const end = rest.indexOf('/');
  return end > 0 ? rest.slice(0, end) : null;
}

/**
 * The address to write as for something that lives in a shared mailbox: one this
 * person may send as (`can_send`), spelled as the server spells it so it matches
 * an option in the From picker. Null for their own mailbox, and for a shared one
 * they may read but not send as -- there they reply as themselves, as before.
 */
export function sendAsFor(
  idOrFolder: string | null | undefined,
  sharedMailboxes: SharedMailbox[],
): string | null {
  const address = sharedAddressOf(idOrFolder)?.toLowerCase();
  if (!address) return null;
  return sharedMailboxes.find((m) => m.can_send && m.address.toLowerCase() === address)?.address ?? null;
}
