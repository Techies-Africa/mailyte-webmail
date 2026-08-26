// Thin fetch wrappers around the webmail BFF routes (app/api/webmail/*),
// which forward to the mail server's mailbox-session-guarded endpoints.
// Every call can come back 401 (session expired/revoked) -- callers pass
// onUnauthorized so the page redirects once, in one place.

import type {
  ApiContact,
  ApiFolder,
  ApiMessageDetail,
  ApiMessageSummary,
  ApiSettings,
} from './adapters';

export type ApiResult<T> = { success: true; data: T } | { success: false; message: string };

async function call<T>(
  input: string,
  init: RequestInit | undefined,
  onUnauthorized: () => void,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { success: false, message: 'Could not reach the mail server. Check your connection.' };
  }

  if (res.status === 401) {
    onUnauthorized();
    return { success: false, message: 'Not logged in' };
  }

  const data = await res.json().catch(() => ({}) as Record<string, unknown>);

  // Two envelopes are accepted on purpose.
  //
  // Mailyte's mail server answers `{ type, msg, data }` -- its own convention
  // across the whole API. Some deployments put a service in front that answers
  // `{ success, message, data }` instead.
  //
  // Reading both means one build works against either, and switching between
  // them is an environment variable rather than a code change.
  const body = data as {
    success?: boolean;
    type?: string;
    message?: string;
    msg?: string;
    data?: T;
  };
  const ok = body.success === true || body.type === 'success';

  if (!ok) {
    return { success: false, message: body.message ?? body.msg ?? 'Request failed' };
  }

  return { success: true, data: body.data as T };
}

export interface MessagePage {
  messages: ApiMessageSummary[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface ListOptions {
  /** null = don't scope to a folder. With `search` set that means search everything. */
  folder: string | null;
  search?: string;
  offset?: number;
  limit?: number;
}

/**
 * One page of messages.
 *
 * Both the paging and the search happen on the mail server (PRD P3/P5) --
 * this used to fetch a folder in its entirety and the UI filtered the result
 * client-side, which is why search could only find what was already
 * on screen.
 */
export function listMessages(options: ListOptions, onUnauthorized: () => void) {
  const qs = new URLSearchParams();
  if (options.folder) qs.set('folder', options.folder);
  if (options.search) qs.set('search', options.search);
  if (options.offset) qs.set('offset', String(options.offset));
  if (options.limit) qs.set('limit', String(options.limit));

  const query = qs.toString();
  return call<MessagePage>(
    `/api/webmail/messages${query ? `?${query}` : ''}`,
    undefined,
    onUnauthorized,
  );
}

/** Real folders with unread counts and the uid_next change token (P2/P4). */
export function listFolders(onUnauthorized: () => void) {
  return call<ApiFolder[]>('/api/webmail/folders', undefined, onUnauthorized);
}

export function createFolder(name: string, onUnauthorized: () => void) {
  return call<{ id: string; name: string }>(
    '/api/webmail/folders',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
    onUnauthorized,
  );
}

/** The rest of a message's conversation, oldest first; empty if it stands alone. */
export function getThread(id: string, onUnauthorized: () => void) {
  return call<ApiMessageSummary[]>(
    `/api/webmail/messages/${encodeURIComponent(id)}/thread`,
    undefined,
    onUnauthorized,
  );
}

/**
 * A message attachment's URL. Same-origin through the BFF, so the browser
 * sends the HttpOnly session cookie and no token is ever exposed to page JS.
 */
export function attachmentUrl(messageId: string, index: number): string {
  return `/api/webmail/messages/${encodeURIComponent(messageId)}/attachments/${index}`;
}

export function getMessage(id: string, onUnauthorized: () => void) {
  return call<ApiMessageDetail>(
    `/api/webmail/messages/${encodeURIComponent(id)}`,
    undefined,
    onUnauthorized,
  );
}

function messageAction(
  id: string,
  action: string,
  body: Record<string, unknown> | undefined,
  onUnauthorized: () => void,
) {
  return call<null>(
    `/api/webmail/messages/${encodeURIComponent(id)}/${action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    },
    onUnauthorized,
  );
}

export const markRead = (id: string, onUnauthorized: () => void) =>
  messageAction(id, 'mark-read', undefined, onUnauthorized);
export const markUnread = (id: string, onUnauthorized: () => void) =>
  messageAction(id, 'mark-unread', undefined, onUnauthorized);
export const star = (id: string, onUnauthorized: () => void) =>
  messageAction(id, 'star', undefined, onUnauthorized);
export const unstar = (id: string, onUnauthorized: () => void) =>
  messageAction(id, 'unstar', undefined, onUnauthorized);
export const moveMessage = (id: string, folder: string, onUnauthorized: () => void) =>
  messageAction(id, 'move', { folder }, onUnauthorized);

/**
 * Move to Trash -- recoverable, and what the delete button does everywhere
 * outside Trash itself. The old client called DELETE straight from a hover
 * icon, which expunged the message off the mail server with no confirmation
 * and no way back (PRD SS7.4).
 */
export const trashMessage = (id: string, onUnauthorized: () => void) =>
  messageAction(id, 'trash', undefined, onUnauthorized);

/**
 * Permanent expunge. The backend refuses unless the message is already in
 * Trash, so no UI path can destroy live mail even by mistake.
 */
export function deleteForever(id: string, onUnauthorized: () => void) {
  return call<null>(
    `/api/webmail/messages/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    onUnauthorized,
  );
}

export interface SendPayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body_text?: string;
  body_html?: string;
  in_reply_to?: string;
  references?: string;
}

export interface SendResult {
  sent: boolean;
  /**
   * False when the message went out but its copy could not be written to
   * Sent yet -- the API has queued a retry. The send still succeeded; the UI
   * says so differently (PRD F4).
   */
  filed_to_sent: boolean;
}

/**
 * Send, with attachments when there are any (PRD P7).
 *
 * With files this is multipart/form-data and the Content-Type header is
 * deliberately NOT set -- the browser has to write it itself so it can
 * include the multipart boundary.
 */
export function sendMessage(
  payload: SendPayload,
  attachments: File[],
  onUnauthorized: () => void,
) {
  if (attachments.length === 0) {
    return call<SendResult>(
      '/api/webmail/messages/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      onUnauthorized,
    );
  }

  const form = new FormData();
  for (const address of payload.to) form.append('to[]', address);
  for (const address of payload.cc ?? []) form.append('cc[]', address);
  for (const address of payload.bcc ?? []) form.append('bcc[]', address);
  form.append('subject', payload.subject);
  if (payload.body_text) form.append('body_text', payload.body_text);
  if (payload.body_html) form.append('body_html', payload.body_html);
  if (payload.in_reply_to) form.append('in_reply_to', payload.in_reply_to);
  if (payload.references) form.append('references', payload.references);
  for (const file of attachments) form.append('attachments[]', file, file.name);

  return call<SendResult>(
    '/api/webmail/messages/send',
    { method: 'POST', body: form },
    onUnauthorized,
  );
}

export interface DraftPayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body_html?: string;
  in_reply_to?: string;
  references?: string;
  /** The revision this one supersedes, removed once the new one is stored. */
  replace_id?: string;
}

/**
 * Save a draft (PRD F6).
 *
 * Attachments are deliberately not part of a draft: re-uploading every
 * attached file every 30 seconds is not a saved draft, it is a denial of
 * service against the user's own connection. The compose window keeps them
 * in memory for the session and warns before a close that would lose them.
 */
export function saveDraft(payload: DraftPayload, onUnauthorized: () => void) {
  return call<{ id: string }>(
    '/api/webmail/messages/draft',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    onUnauthorized,
  );
}

export function discardDraft(id: string, onUnauthorized: () => void) {
  return call<null>(
    `/api/webmail/messages/draft/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    onUnauthorized,
  );
}

/** Autocomplete suggestions harvested from message headers (PRD C2). */
export function listContacts(onUnauthorized: () => void) {
  return call<ApiContact[]>('/api/webmail/contacts', undefined, onUnauthorized);
}

export function getSettings(onUnauthorized: () => void) {
  return call<ApiSettings>('/api/webmail/settings', undefined, onUnauthorized);
}

export function updateSettings(
  payload: {
    signature_html?: string;
    signature_on_reply?: boolean;
    display_density?: 'comfortable' | 'compact';
    undo_send_enabled?: boolean;
    undo_send_seconds?: number;
  },
  onUnauthorized: () => void,
) {
  return call<Partial<ApiSettings>>(
    '/api/webmail/settings',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    onUnauthorized,
  );
}

// --- S3: the holder's own security surface -------------------------------

export interface ApiSecurity {
  two_factor_enabled: boolean;
  two_factor_confirmed_at: string | null;
  recovery_codes_remaining: number;
  /** "webmail_sign_in_only" -- the UI must not overclaim the reach. */
  protects: string;
}

export interface ApiTwoFactorEnrolment {
  secret: string;
  qr_code_svg: string;
  recovery_codes: string[];
}

export interface ApiSession {
  id: string;
  signed_in_at: string | null;
  expires_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  revoked: boolean;
  active: boolean;
  current: boolean;
}

export function getSecurity(onUnauthorized: () => void) {
  return call<ApiSecurity>('/api/webmail/security', undefined, onUnauthorized);
}

export function beginTwoFactor(onUnauthorized: () => void) {
  return call<ApiTwoFactorEnrolment>(
    '/api/webmail/security/2fa/begin',
    { method: 'POST' },
    onUnauthorized,
  );
}

export function confirmTwoFactor(code: string, onUnauthorized: () => void) {
  return call<{ two_factor_enabled: boolean }>(
    '/api/webmail/security/2fa/confirm',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    },
    onUnauthorized,
  );
}

export function disableTwoFactor(code: string, onUnauthorized: () => void) {
  return call<{ two_factor_enabled: boolean }>(
    '/api/webmail/security/2fa/disable',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    },
    onUnauthorized,
  );
}

export function listSessions(onUnauthorized: () => void) {
  return call<{ scope: string; sessions: ApiSession[] }>(
    '/api/webmail/security/sessions',
    undefined,
    onUnauthorized,
  );
}

export function revokeSession(id: string, onUnauthorized: () => void) {
  return call<null>(
    `/api/webmail/security/sessions/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    onUnauthorized,
  );
}

// --- Sieve-backed settings: forwarding, filter rules, vacation -----------

export interface ApiForwarding {
  enabled: boolean;
  addresses: string[];
  keep_copy: boolean;
  /** False when a forwarding script exists that the webmail did not write. */
  managed: boolean;
}

export interface ApiRule {
  id?: string;
  name: string;
  match?: 'all' | 'any';
  enabled?: boolean;
  conditions: Array<{ field: string; operator?: string; value?: string }>;
  actions: Array<{ type: string; value?: string }>;
}

export function getForwarding(onUnauthorized: () => void) {
  return call<ApiForwarding>('/api/webmail/forwarding', undefined, onUnauthorized);
}

export function updateForwarding(payload: Omit<ApiForwarding, 'managed'>, onUnauthorized: () => void) {
  return call<ApiForwarding>(
    '/api/webmail/forwarding',
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    onUnauthorized,
  );
}

export function getRules(onUnauthorized: () => void) {
  return call<{ rules: ApiRule[]; active: boolean; managed: boolean }>(
    '/api/webmail/rules',
    undefined,
    onUnauthorized,
  );
}

export function updateRules(rules: ApiRule[], onUnauthorized: () => void) {
  return call<{ rules: ApiRule[] }>(
    '/api/webmail/rules',
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }) },
    onUnauthorized,
  );
}

export interface ApiVacation {
  enabled: boolean;
  subject?: string | null;
  message?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export function getVacation(onUnauthorized: () => void) {
  return call<{ enabled: boolean; raw: string | null }>(
    '/api/webmail/vacation',
    undefined,
    onUnauthorized,
  );
}

export function updateVacation(payload: ApiVacation, onUnauthorized: () => void) {
  return call<{ enabled: boolean }>(
    '/api/webmail/vacation',
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    onUnauthorized,
  );
}

export function aiCompose(
  instruction: string,
  existingDraft: string | undefined,
  onUnauthorized: () => void,
) {
  return call<{ draft: string }>(
    '/api/webmail/ai/compose',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction, existing_draft: existingDraft || undefined }),
    },
    onUnauthorized,
  );
}

export function aiSummarize(id: string, onUnauthorized: () => void) {
  return call<{ summary: string }>(
    `/api/webmail/ai/summarize/${encodeURIComponent(id)}`,
    { method: 'POST' },
    onUnauthorized,
  );
}

export async function logout() {
  await fetch('/api/webmail-auth/logout', { method: 'POST' });
}
