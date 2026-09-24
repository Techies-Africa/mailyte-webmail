import type { WebmailListItem } from '@/components/webmail/types';

/**
 * Tags on a message row: what the message IS, read off the message itself.
 *
 * Two sources, drawn the same way:
 *
 *  - **Labels** the person (or their filter rules) put on the message. IMAP
 *    keywords, stored on the server, seen by every client.
 *  - **Automatic tags**, worked out here from the sender, subject and preview
 *    by fixed rules -- a receipt says "receipt", a sign-in check says
 *    "verification", a DMARC report says "Report Domain". Deterministic, no
 *    model, no network, and each rule is a line anyone can read. They are
 *    never stored: a message that stops matching stops being tagged.
 *
 * At most one automatic tag per row, by the order below, so a row never
 * fills up with guesses. Labels always show.
 */

export type TagTone = 'neutral' | 'primary' | 'warning' | 'danger' | 'success';

export interface RowTag {
  key: string;
  label: string;
  tone: TagTone;
  /** True for a label the person set; false for an automatic tag. */
  applied: boolean;
}

interface AutoRule {
  key: string;
  label: string;
  tone: TagTone;
  /** Tested against the subject. */
  subject?: RegExp;
  /** Tested against the sender address. */
  from?: RegExp;
  /** Tested against subject + preview together. */
  text?: RegExp;
}

/** Ordered by how much the tag changes what the reader should do next. */
const AUTO_RULES: AutoRule[] = [
  {
    key: 'security',
    label: 'Security',
    tone: 'danger',
    subject:
      /\b(verif(?:y|ication)|sign[- ]?in|log[- ]?in|password|passcode|one[- ]time|2fa|two[- ]factor|security (?:alert|code|notice)|new (?:device|sign)|unusual activity|suspicious)\b/i,
  },
  {
    key: 'action',
    label: 'Action needed',
    tone: 'warning',
    subject:
      /\b(action (?:needed|required)|expir(?:es|ing|ed|y)|renew(?:al)?|overdue|past due|final (?:notice|reminder)|last chance|unsuccessful|failed payment|payment (?:failed|declined|unsuccessful)|update your (?:payment|billing|card)|reply (?:needed|required)|respond by)\b/i,
  },
  {
    key: 'alert',
    label: 'Alert',
    tone: 'warning',
    subject: /(^\s*\[?alert\]?|\balert\b|\bwarning\b|\bincident\b|\boutage\b|\bcertificate\b)/i,
  },
  {
    key: 'dmarc',
    label: 'DMARC',
    tone: 'primary',
    subject: /\b(dmarc|report domain:|aggregate report)\b/i,
    from: /dmarc|noreply-dmarc/i,
  },
  {
    key: 'receipt',
    label: 'Receipt',
    tone: 'success',
    subject:
      /\b(receipt|invoice|payment (?:received|successful|confirmation)|order (?:confirmation|confirmed|#?\d+)|your order|paid\b|billing statement|statement is ready|tax invoice)\b/i,
    from: /^(?:billing|invoice|invoices|receipts?|payments?|noreply\+billing)@/i,
  },
  {
    key: 'invite',
    label: 'Invitation',
    tone: 'primary',
    subject: /\b(invitation|invited you|has invited|calendar invite|meeting request)\b/i,
  },
  {
    key: 'shipping',
    label: 'Delivery',
    tone: 'neutral',
    subject: /\b(shipped|out for delivery|delivered|tracking number|your package|your parcel)\b/i,
  },
];

/** The one automatic tag for a row, or null. */
export function autoTag(item: Pick<WebmailListItem, 'subject' | 'fromEmail' | 'preview'>): RowTag | null {
  const subject = item.subject ?? '';
  const from = item.fromEmail ?? '';
  const text = `${subject}\n${item.preview ?? ''}`;
  for (const rule of AUTO_RULES) {
    const hit =
      (rule.subject && rule.subject.test(subject)) ||
      (rule.from && rule.from.test(from)) ||
      (rule.text && rule.text.test(text));
    if (hit) return { key: `auto:${rule.key}`, label: rule.label, tone: rule.tone, applied: false };
  }
  return null;
}

/** "action_needed" -> "Action needed". The server keeps slugs; people read words. */
export function labelTitle(slug: string): string {
  const words = slug.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A stable colour per label so the same word looks the same everywhere. A
 * few well-known names get the tone people expect; the rest cycle by hash.
 */
export function labelTone(slug: string): TagTone {
  if (/^(urgent|important|security|fraud|overdue)$/.test(slug)) return 'danger';
  if (/^(action_needed|todo|to_do|follow_up|followup|waiting|pending)$/.test(slug)) return 'warning';
  if (/^(receipt|receipts|paid|done|approved)$/.test(slug)) return 'success';
  if (/^(dmarc|reports?|work|project|projects)$/.test(slug)) return 'primary';
  const tones: TagTone[] = ['primary', 'success', 'warning', 'neutral'];
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  return tones[hash % tones.length];
}

export function labelTag(slug: string): RowTag {
  return { key: `label:${slug}`, label: labelTitle(slug), tone: labelTone(slug), applied: true };
}

/** Every tag a row shows: the person's labels first, then the automatic one. */
export function rowTags(item: WebmailListItem, options: { auto: boolean }): RowTag[] {
  const tags = item.labels.map(labelTag);
  if (options.auto) {
    const auto = autoTag(item);
    // Skip the guess when the person already labelled it the same thing.
    if (auto && !tags.some((t) => t.label.toLowerCase() === auto.label.toLowerCase())) tags.push(auto);
  }
  return tags;
}
