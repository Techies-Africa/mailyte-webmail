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
  hasAttachment: boolean;
  timestamp: Date;
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
  references: string | null;
  attachments: WebmailAttachment[];
}

/** An autocomplete suggestion, harvested from message headers (PRD C2). */
export interface WebmailContact {
  name: string | null;
  email: string;
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
  storage: { usedMb: number; quotaMb: number; percentage: number | null };
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
