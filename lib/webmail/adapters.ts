// Maps the mail server's wire shape (snake_case JSON) onto the view models
// the components consume (components/webmail/types.ts).
//
// One boundary, in one file: the components never see wire field names, and
// the API never has to match a UI shape. Fields the backend has not started
// sending yet degrade to empty rather than to a fabricated placeholder --
// an absent preview renders as no preview, never as invented text.

import type {
  WebmailAttachment,
  WebmailContact,
  WebmailFolder,
  WebmailSettings,
  WebmailListItem,
  WebmailMessage,
  WebmailParticipant,
} from '@/components/webmail/types';

export interface ApiParticipant {
  name: string | null;
  email: string;
}

export interface ApiMessageSummary {
  id: string;
  folder: string;
  subject: string;
  from: ApiParticipant[];
  to: ApiParticipant[];
  cc?: ApiParticipant[];
  bcc?: ApiParticipant[];
  reply_to?: ApiParticipant[];
  received_at: string | null;
  size: number;
  has_attachment: boolean;
  is_read: boolean;
  is_starred: boolean;
  is_answered?: boolean;
  is_draft?: boolean;
  preview?: string | null;
  thread_id?: string | null;
  message_id?: string | null;
  in_reply_to?: string | null;
  references?: string | null;
}

export interface ApiAttachment {
  index: number;
  name: string;
  type: string;
  size: number;
  is_inline: boolean;
  content_id: string | null;
}

export interface ApiMessageDetail extends ApiMessageSummary {
  body_text: string | null;
  body_html: string | null;
  message_id: string | null;
  references: string | null;
  attachments?: ApiAttachment[];
}

export interface ApiContact {
  name: string | null;
  email: string;
  count: number;
}

export interface ApiSettings {
  email_address: string;
  name: string | null;
  signature_html: string;
  signature_on_reply: boolean;
  display_density: 'comfortable' | 'compact';
  undo_send_enabled: boolean;
  undo_send_seconds: number;
  storage: { used_mb: number; quota_mb: number; percentage: number | null };
}

export interface ApiFolder {
  id: string;
  name: string;
  role: string | null;
  total: number;
  unread: number;
  /**
   * IMAP's own change tokens. uid_next moving means mail arrived;
   * uid_validity moving means anything cached about this folder is stale.
   * Polling these is the webmail's delta sync (PRD P4).
   */
  uid_next: number;
  uid_validity: number;
}

function participants(list: ApiParticipant[] | undefined | null): WebmailParticipant[] {
  return (list ?? []).filter((p) => !!p?.email);
}

function displayName(p: WebmailParticipant | undefined): string {
  if (!p) return 'Unknown sender';
  return p.name || p.email || 'Unknown sender';
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain-text bodies have to become HTML for the reading pane's iframe. */
export function textToSafeHtml(text: string): string {
  return `<p>${escapeHtml(text).replace(/\n/g, '<br/>')}</p>`;
}

export function toListItem(m: ApiMessageSummary): WebmailListItem {
  const from = participants(m.from);
  return {
    id: m.id,
    threadId: m.thread_id ?? null,
    from: displayName(from[0]),
    fromEmail: from[0]?.email ?? '',
    to: participants(m.to),
    cc: participants(m.cc),
    subject: m.subject || '(no subject)',
    preview: (m.preview ?? '').trim(),
    isRead: m.is_read,
    isStarred: m.is_starred,
    isAnswered: m.is_answered ?? false,
    isDraft: m.is_draft ?? false,
    hasAttachment: m.has_attachment,
    timestamp: m.received_at ? new Date(m.received_at) : new Date(),
    folder: m.folder,
  };
}

export function toMessage(m: ApiMessageDetail): WebmailMessage {
  const body =
    m.body_html || (m.body_text ? textToSafeHtml(m.body_text) : '<p><em>(no content)</em></p>');

  return {
    ...toListItem(m),
    body,
    bodyIsHtml: !!m.body_html,
    replyTo: participants(m.reply_to),
    bcc: participants(m.bcc),
    messageIdHeader: m.message_id ?? null,
    references: m.references ?? null,
    attachments: (m.attachments ?? []).map(toAttachment),
  };
}

export function toAttachment(a: ApiAttachment): WebmailAttachment {
  return {
    index: a.index,
    name: a.name,
    type: a.type,
    size: a.size,
    contentId: a.content_id ?? null,
    isInline: a.is_inline,
  };
}

export function toContact(c: ApiContact): WebmailContact {
  return { name: c.name ?? null, email: c.email };
}

export function toSettings(s: ApiSettings): WebmailSettings {
  return {
    emailAddress: s.email_address,
    name: s.name ?? null,
    signatureHtml: s.signature_html ?? '',
    signatureOnReply: s.signature_on_reply ?? true,
    displayDensity: s.display_density ?? 'comfortable',
    // Off unless the holder turned it on -- the delay is paid on every send.
    undoSendEnabled: s.undo_send_enabled ?? false,
    undoSendSeconds: s.undo_send_seconds ?? 5,
    storage: {
      usedMb: s.storage?.used_mb ?? 0,
      quotaMb: s.storage?.quota_mb ?? 0,
      percentage: s.storage?.percentage ?? null,
    },
  };
}

export function toFolder(f: ApiFolder): WebmailFolder {
  return {
    id: f.id,
    name: f.name,
    role: f.role ?? null,
    totalEmails: f.total ?? 0,
    unreadEmails: f.unread ?? 0,
    uidNext: f.uid_next ?? 0,
    uidValidity: f.uid_validity ?? 0,
  };
}

/**
 * A single string summarising every folder's change tokens. Two of these
 * being equal means nothing has arrived, moved or been deleted anywhere in
 * the mailbox since the last poll -- which is the whole delta check (P4),
 * for the cost of one request that transfers no messages.
 */
export function foldersFingerprint(folders: WebmailFolder[]): string {
  return folders
    .map((f) => `${f.name}:${f.uidNext}:${f.uidValidity}:${f.totalEmails}:${f.unreadEmails}`)
    .sort()
    .join('|');
}

/**
 * Until the folders endpoint answers (first paint, or a deployment whose mail
 * server predates it), the sidebar still needs something to render. These are
 * the six folders Dovecot provisions for every mailbox in this stack, with no
 * counts claimed -- a real fallback, not invented data.
 */
export const FALLBACK_FOLDERS: WebmailFolder[] = (
  [
    ['INBOX', 'inbox'],
    ['Drafts', 'drafts'],
    ['Sent', 'sent'],
    ['Archive', 'archive'],
    ['Junk', 'junk'],
    ['Trash', 'trash'],
  ] as const
).map(([name, role]) => ({
  id: name,
  name,
  role,
  totalEmails: 0,
  unreadEmails: 0,
  uidNext: 0,
  uidValidity: 0,
}));
