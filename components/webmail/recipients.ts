import type { WebmailContact, WebmailMessage } from './types';

/**
 * The recipient strings compose speaks: entries separated by commas or
 * semicolons, each a bare `ada@x.com` or `Ada Lovelace <ada@x.com>`. Shared
 * by the To / Cc / Bcc chips and by the minimized compose tab, which names
 * who a message is for.
 */

export function splitRecipients(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** "Ada Lovelace <ada@x.com>" -> "ada@x.com"; a bare address passes through. */
export function extractEmail(entry: string): string {
  const match = entry.match(/<([^>]+)>/);
  return (match ? match[1] : entry).trim();
}

/** The name written with the address ("Ada Lovelace <ada@x.com>" -> "Ada Lovelace"), or null for a bare one. */
export function namePart(entry: string): string | null {
  const named = entry.match(/^(.*?)\s*<[^>]+>$/);
  const name = named?.[1]?.trim().replace(/^["']|["']$/g, '');
  return name ? name : null;
}

/** Prefer the display name on the chip; fall back to the address. */
export function displayChip(entry: string): string {
  return namePart(entry) ?? extractEmail(entry);
}

/** Enough of the message being replied to, to name who it was from. */
export type RepliedTo = Pick<WebmailMessage, 'from' | 'fromEmail' | 'replyTo'>;

export type Recipient = { name: string; email: string; others: number };

/**
 * The first person in a recipient line, named as well as we can: the name
 * written with the address (a pick from the suggestions keeps it), else the
 * address book's, else -- for a reply -- the name on the message being
 * answered (its sender or its Reply-To, which is where a reply goes when
 * set), else the address itself. Null while the line is empty.
 *
 * Shared by the minimized compose tab and the open window's title bar
 * (ComposeDock, ComposeWindow) -- the one thing that made them disagree
 * about whose avatar to show was each computing this separately.
 */
export function primaryRecipient(
  to: string,
  contacts: WebmailContact[],
  repliedTo?: RepliedTo | null,
): Recipient | null {
  const entries = splitRecipients(to);
  if (entries.length === 0) return null;
  const email = extractEmail(entries[0]);
  const key = email.toLowerCase();
  const fromBook = contacts.find((c) => c.email.toLowerCase() === key)?.name ?? null;
  const answered = repliedTo ? [{ name: repliedTo.from, email: repliedTo.fromEmail }, ...repliedTo.replyTo] : [];
  const fromReply = answered.find((p) => p.email.toLowerCase() === key)?.name || null;
  const name = namePart(entries[0]) || fromBook || fromReply || email;
  return { name, email, others: entries.length - 1 };
}
