import type { FileLinkRef } from './compose/fileLinks';

// Shared view-model types for the webmail client.
//
// These are the shapes `lib/webmail/adapters.ts` produces from the real API
// -- deliberately owned here rather than inferred with `any` at every call
// site, which is how the forked demo components ended up unable to tell a
// real message from a fabricated one (PRD 01-PRD-webmail.md SS2 E1).

export interface WebmailParticipant {
  name: string | null;
  email: string;
}

export interface WebmailAttachment {
  index: number;
  name: string;
  type: string;
  size: number;
  contentId: string | null;
  isInline: boolean;
}

/** A row in the message list. Never has a body -- open it for that. */
export interface WebmailListItem {
  id: string;
  threadId: string | null;
  from: string;
  fromEmail: string;
  to: WebmailParticipant[];
  cc: WebmailParticipant[];
  subject: string;
  preview: string;
  isRead: boolean;
  isStarred: boolean;
  isAnswered: boolean;
  isDraft: boolean;
  /** Labels the message carries, as the server's lowercase slugs. */
  labels: string[];
  hasAttachment: boolean;
  /** This person was @mentioned in it (the $Mentioned keyword; plans/21-mentions). */
  mentioned?: boolean;
  /**
   * The date to DISPLAY. Never null -- a message whose header carried no date
   * falls back to now, so every row has something to print.
   *
   * Do not sort on this. See `receivedAt`.
   */
  timestamp: Date;
  /**
   * When the message was actually sent, or null if it said nothing.
   *
   * This is the one to sort on: the fallback in `timestamp` would make an
   * undated message the newest in any conversation.
   */
  receivedAt: Date | null;
  folder: string;
}

/** An opened message: everything a list row has, plus content. */
export interface WebmailMessage extends WebmailListItem {
  body: string;
  bodyIsHtml: boolean;
  replyTo: WebmailParticipant[];
  bcc: WebmailParticipant[];
  /** The real RFC 822 Message-Id header, not the JMAP resource id. */
  messageIdHeader: string | null;
  /** The Message-ID this one answers; on a saved reply draft, what keeps it in its thread. */
  inReplyTo: string | null;
  references: string | null;
  attachments: WebmailAttachment[];
  /** A draft's files sent as download links, brought back when it is resumed. */
  fileLinks?: FileLinkRef[];
  /** What the headers say about where the message came from and how. */
  provenance: WebmailProvenance;
}

export interface WebmailProvenance {
  /** The Return-Path domain: who handed the message to us. */
  mailedBy: string | null;
  /** The DKIM signing domain, when the signature verified. */
  signedBy: string | null;
  /** "tls" or "none" for the last hop; null when the header did not say. */
  security: string | null;
  listUnsubscribe: { mailto: string | null; url: string | null; one_click: boolean } | null;
  /** Verdicts from the Authentication-Results this server wrote: pass / fail / none / null. */
  authentication: { spf: string | null; dkim: string | null; dmarc: string | null };
}

/**
 * An autocomplete suggestion for the recipient fields.
 *
 * Two sources feed this, and the difference is worth keeping: addresses
 * harvested from message headers (PRD C2) cover everyone the mailbox has
 * written to, while `saved` entries come from the CardDAV address book and
 * are people the owner deliberately kept. Saved ones rank first and carry a
 * marker, so picking the curated record over a half-remembered header is the
 * default rather than a coincidence of ordering.
 */
export interface WebmailContact {
  name: string | null;
  email: string;
  /**
   * Which list this suggestion came from, and the order they rank in.
   *
   * `saved` -- a card the holder chose to keep. `directory` -- a colleague,
   * from the company directory. Absent -- harvested from message headers,
   * which covers everyone written to but nobody deliberately.
   *
   * One field rather than a boolean per source: they are mutually exclusive
   * (the merge in app/page.tsx keeps the first occurrence of an address), and
   * two independent flags would let a contact claim to be both.
   */
  source?: 'saved' | 'directory';
  /**
   * Already on the email being written or replied to (sender, To, Cc, or the
   * draft's own recipient fields). Set only for @mention suggestions, which
   * list these people first.
   */
  onThread?: boolean;
}

export interface WebmailSettings {
  emailAddress: string;
  name: string | null;
  signatureHtml: string;
  signatureOnReply: boolean;
  displayDensity: 'comfortable' | 'compact';
  /** Undo-send: opt-in, because the delay applies to every message sent. */
  undoSendEnabled: boolean;
  undoSendSeconds: number;
  /**
   * Track opens / clicks on the mail this mailbox sends. ABSENT (undefined)
   * when the mail server does not offer the feature -- an older server, or
   * one with it switched off -- which is the cue to show no switches at all.
   * Off unless the holder turned them on.
   */
  trackOpens?: boolean;
  trackClicks?: boolean;
  storage: { usedMb: number; quotaMb: number; percentage: number | null };
  /**
   * Set only when Mailyte staff opened this mailbox to look into a problem
   * (a one-hour support session); null for the holder's own sign-in.
   */
  supportSession: { endsAt: string } | null;
}

/**
 * What happened to a message the mailbox sent. The statuses are the words
 * Mailyte's dashboard (Email Activity) uses, strongest first.
 */
export type DeliveryStatus =
  | 'bounced'
  | 'rejected'
  | 'complained'
  | 'clicked'
  | 'opened'
  | 'delivered'
  | 'deferred'
  | 'pending';

export type SpamVerdict = 'good' | 'fair' | 'poor';

/** What pushed a spam score up, and where the fix lives. */
export interface SpamReason {
  rule: string;
  /** content = the email itself, setup = the domain's DNS, sender = From name/address. */
  kind: 'content' | 'setup' | 'sender';
  plain: string;
  fix: string;
}

export interface WebmailEngagement {
  count: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

export interface WebmailDelivery {
  /** What was switched on when the message went; both false = tracking was off. */
  trackedOpens: boolean;
  trackedClicks: boolean;
  recipients: { email: string; status: DeliveryStatus }[];
  /** The real number of recipients: more than `recipients.length` when a long list was cut. */
  recipientsTotal: number;
  opens: WebmailEngagement | null;
  clicks: (WebmailEngagement & { links: string[] }) | null;
  /** Null until the filter's score has been recorded. */
  spam: { score: number; verdict: SpamVerdict; reasons: SpamReason[] } | null;
}

export interface WebmailFolder {
  id: string;
  name: string;
  /** JMAP role: inbox/sent/drafts/junk/trash/archive, or null for a custom folder. */
  role: string | null;
  totalEmails: number;
  unreadEmails: number;
  /** IMAP change tokens -- see foldersFingerprint() in lib/webmail/adapters. */
  uidNext: number;
  uidValidity: number;
}

export type ComposeMode = 'compose' | 'reply' | 'replyAll' | 'forward';

export interface ComposeDraft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

export interface SendResult {
  success: boolean;
  message?: string;
}
