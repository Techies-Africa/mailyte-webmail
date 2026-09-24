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
} from "./adapters";

export type ApiResult<T> =
  { success: true; data: T } | { success: false; message: string };

async function call<T>(
  input: string,
  init: RequestInit | undefined,
  onUnauthorized: () => void,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return {
      success: false,
      message: "Could not reach the mail server. Check your connection.",
    };
  }

  if (res.status === 401) {
    onUnauthorized();
    return { success: false, message: "Not logged in" };
  }

  const data = await res.json().catch(() => ({}) as Record<string, unknown>);

  // A session carrying a temporary password: real, but allowed to do exactly
  // two things -- set a password, and sign out. Every other mailbox route
  // answers this, so it is handled here for the same reason 401 is: one
  // place, rather than every caller having to recognise it.
  //
  // Sign-in already routes to this screen, so reaching here means arriving
  // some other way -- a bookmarked inbox URL, a restored tab, or a session
  // that was flagged by an admin reset while it was open. A hard assign
  // rather than a router push: this module has no router, and the point is to
  // leave a page that cannot load anything anyway.
  if (res.status === 403) {
    const code =
      (data as { error_code?: string; detail?: { error_code?: string } })
        ?.error_code ??
      (data as { detail?: { error_code?: string } })?.detail?.error_code;
    if (code === "password_change_required" && typeof window !== "undefined") {
      if (window.location.pathname !== "/change-password") {
        window.location.assign("/change-password");
      }
      return { success: false, message: "Set a new password to continue" };
    }
  }

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
  const ok = body.success === true || body.type === "success";

  if (!ok) {
    return {
      success: false,
      message: body.message ?? body.msg ?? "Request failed",
    };
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
  /** Server-side filters: IMAP SEARCH UNSEEN / FLAGGED. */
  unread?: boolean;
  starred?: boolean;
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
  if (options.folder) qs.set("folder", options.folder);
  if (options.search) qs.set("search", options.search);
  if (options.offset) qs.set("offset", String(options.offset));
  if (options.limit) qs.set("limit", String(options.limit));
  if (options.unread) qs.set("unread", "true");
  if (options.starred) qs.set("starred", "true");

  const query = qs.toString();
  return call<MessagePage>(
    `/api/webmail/messages${query ? `?${query}` : ""}`,
    undefined,
    onUnauthorized,
  );
}

/**
 * Which optional features this deployment's server actually has.
 *
 * `ai`, `rules`, `forwarding` and `vacation` depend on configuration the
 * server may not have -- an AI endpoint, a Sieve master credential -- so the
 * client asks rather than assumes. Nothing called this before, which is why
 * "AI Write" appeared on a deployment with no AI configured and failed with a
 * retry-flavoured error every time it was pressed.
 *
 * Keys are a published contract for self-hosters: add, never rename.
 */
export interface ApiCapabilities {
  email_address: string;
  capabilities: {
    mail: boolean;
    send: boolean;
    settings: boolean;
    two_factor: boolean;
    rules: boolean;
    forwarding: boolean;
    vacation: boolean;
    ai: boolean;
    /** phase-09: this deployment runs a calendar (CalDAV) service. */
    calendar: boolean;
    /**
     * phase-09: this deployment runs an address book (CardDAV) service.
     *
     * Its own key rather than folded into `calendar`, even though both come
     * from the same `dav` service, so the two can be turned on separately and
     * a client can tell which it is looking at without inferring it.
     */
    contacts: boolean;
    /**
     * This server can hold a message and send it later.
     *
     * Optional in the type because an older mail server does not report the
     * key at all -- and there it must read as absent, not as present. A
     * server that does not know `send_at` ignores the field and sends the
     * message IMMEDIATELY, so a schedule control shown against one would be
     * the worst kind of wrong.
     */
    scheduled_send?: boolean;
  };
  /**
   * Shared mailboxes this person is a member of, with what they may do there.
   * `can_send` is true for full_access, send_as and send_on_behalf -- the
   * three permissions POST /messages/send accepts a `from` for.
   */
  shared_mailboxes?: SharedMailbox[];
}

export interface SharedMailbox {
  address: string;
  name: string;
  permission: string;
  can_send: boolean;
}

export function getCapabilities(onUnauthorized: () => void) {
  return call<ApiCapabilities>(
    "/api/webmail/capabilities",
    undefined,
    onUnauthorized,
  );
}

/** Real folders with unread counts and the uid_next change token (P2/P4). */
export function listFolders(onUnauthorized: () => void) {
  return call<ApiFolder[]>("/api/webmail/folders", undefined, onUnauthorized);
}

export function createFolder(name: string, onUnauthorized: () => void) {
  return call<{ id: string; name: string }>(
    "/api/webmail/folders",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
    onUnauthorized,
  );
}

/**
 * Rename a folder. `id` is the folder's id from GET /folders and `name` the
 * new LAST path segment; IMAP RENAME carries subfolders along. The server
 * refuses INBOX and the special-use folders with 409.
 */
export function renameFolder(id: string, name: string, onUnauthorized: () => void) {
  return call<{ id: string; name: string; folders: ApiFolder[] }>(
    `/api/webmail/folders/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
    onUnauthorized,
  );
}

/** Delete an EMPTY folder. The server refuses one that still holds mail. */
export function deleteFolder(id: string, onUnauthorized: () => void) {
  return call<null>(
    `/api/webmail/folders/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    onUnauthorized,
  );
}

// --- Blocked senders ------------------------------------------------------

export interface ApiBlockedSenders {
  addresses: string[];
  /** False when a blocked-senders script exists that this UI did not write. */
  managed: boolean;
  /** Where blocked mail goes. Always Junk; reported so the UI never guesses. */
  folder: string;
  limit: number;
}

export function getBlockedSenders(onUnauthorized: () => void) {
  return call<ApiBlockedSenders>("/api/webmail/blocked-senders", undefined, onUnauthorized);
}

export function blockSender(address: string, onUnauthorized: () => void) {
  return call<ApiBlockedSenders>(
    "/api/webmail/blocked-senders",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    },
    onUnauthorized,
  );
}

export function unblockSender(address: string, onUnauthorized: () => void) {
  return call<ApiBlockedSenders>(
    `/api/webmail/blocked-senders/${encodeURIComponent(address)}`,
    { method: "DELETE" },
    onUnauthorized,
  );
}

/** The original message as stored (.eml), same-origin through the BFF. */
export function rawMessageUrl(messageId: string): string {
  return `/api/webmail/messages/${encodeURIComponent(messageId)}/raw`;
}

/** The same bytes as plain text, for the "Show original" page. */
export function rawMessageTextUrl(messageId: string): string {
  return `${rawMessageUrl(messageId)}?format=text`;
}

/** The "Show original" page for a message. Opens in its own tab. */
export function originalPageUrl(messageId: string): string {
  return `/original?id=${encodeURIComponent(messageId)}`;
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

/**
 * The same bytes, asked to render in the browser rather than download. The
 * proxy honours it only for types a browser shows without executing anything
 * (images, PDF, plain text, audio, video); anything else downloads regardless.
 */
export function attachmentPreviewUrl(messageId: string, index: number): string {
  return `${attachmentUrl(messageId, index)}?disposition=inline`;
}

/** Whether the browser can show this type on its own, matching the proxy's allowlist. */
export function isPreviewableAttachment(type: string): boolean {
  const t = type.split(";")[0].trim().toLowerCase();
  return (
    /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(t) ||
    t === "application/pdf" ||
    t === "text/plain" ||
    t === "text/csv" ||
    /^audio\/(mpeg|mp4|ogg|wav|webm)$/.test(t) ||
    /^video\/(mp4|webm|ogg)$/.test(t)
  );
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
    onUnauthorized,
  );
}

export const markRead = (id: string, onUnauthorized: () => void) =>
  messageAction(id, "mark-read", undefined, onUnauthorized);
export const markUnread = (id: string, onUnauthorized: () => void) =>
  messageAction(id, "mark-unread", undefined, onUnauthorized);
export const star = (id: string, onUnauthorized: () => void) =>
  messageAction(id, "star", undefined, onUnauthorized);
export const unstar = (id: string, onUnauthorized: () => void) =>
  messageAction(id, "unstar", undefined, onUnauthorized);
export const moveMessage = (
  id: string,
  folder: string,
  onUnauthorized: () => void,
) => messageAction(id, "move", { folder }, onUnauthorized);

/**
 * Move to Trash -- recoverable, and what the delete button does everywhere
 * outside Trash itself. The old client called DELETE straight from a hover
 * icon, which expunged the message off the mail server with no confirmation
 * and no way back (PRD SS7.4).
 */
export const trashMessage = (id: string, onUnauthorized: () => void) =>
  messageAction(id, "trash", undefined, onUnauthorized);

/**
 * Permanent expunge. The backend refuses unless the message is already in
 * Trash, so no UI path can destroy live mail even by mistake.
 */
export function deleteForever(id: string, onUnauthorized: () => void) {
  return call<null>(
    `/api/webmail/messages/${encodeURIComponent(id)}`,
    { method: "DELETE" },
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
  /**
   * ISO-8601 instant to send at instead of now (schedule send). Absolute,
   * from `Date.toISOString()`: the server converts it to its own clock, so
   * a person scheduling 9am in Lagos gets 9am in Lagos whatever the server
   * is set to.
   */
  send_at?: string;
  /**
   * Send as a shared mailbox. Only honoured when the session holds a sending
   * permission on that address (see SharedMailbox.can_send); the server
   * refuses otherwise, so the client only offers addresses it was told about.
   */
  from?: string;
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
      "/api/webmail/messages/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      onUnauthorized,
    );
  }

  const form = new FormData();
  for (const address of payload.to) form.append("to[]", address);
  for (const address of payload.cc ?? []) form.append("cc[]", address);
  for (const address of payload.bcc ?? []) form.append("bcc[]", address);
  form.append("subject", payload.subject);
  if (payload.body_text) form.append("body_text", payload.body_text);
  if (payload.body_html) form.append("body_html", payload.body_html);
  if (payload.in_reply_to) form.append("in_reply_to", payload.in_reply_to);
  if (payload.references) form.append("references", payload.references);
  if (payload.send_at) form.append("send_at", payload.send_at);
  if (payload.from) form.append("from", payload.from);
  for (const file of attachments) form.append("attachments[]", file, file.name);

  return call<SendResult>(
    "/api/webmail/messages/send",
    { method: "POST", body: form },
    onUnauthorized,
  );
}

/**
 * One message waiting in the Scheduled folder.
 *
 * `id` is the ordinary FOLDER:UID message id, so this list merges onto the
 * folder listing the client already has rather than being fetched twice.
 * `status` is 'pending' or 'failed' -- a failed one is still listed on
 * purpose: a message that did not go out is the one most worth showing.
 */
export interface ScheduledMessage {
  id: string;
  folder: string;
  send_at: string | null;
  status: string;
  attempts: number;
  error: string | null;
  created_at: string | null;
}

export function listScheduled(onUnauthorized: () => void) {
  return call<{ messages: ScheduledMessage[] }>(
    "/api/webmail/messages/scheduled",
    undefined,
    onUnauthorized,
  );
}

/** Cancel a scheduled send. The message is moved back to Drafts, not lost. */
export function cancelScheduled(id: string, onUnauthorized: () => void) {
  return call<{ id: string; folder: string }>(
    `/api/webmail/messages/scheduled/${encodeURIComponent(id)}`,
    { method: "DELETE" },
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
    "/api/webmail/messages/draft",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    onUnauthorized,
  );
}

export function discardDraft(id: string, onUnauthorized: () => void) {
  return call<null>(
    `/api/webmail/messages/draft/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    onUnauthorized,
  );
}

/** Autocomplete suggestions harvested from message headers (PRD C2). */
export function listContacts(onUnauthorized: () => void) {
  return call<ApiContact[]>("/api/webmail/contacts", undefined, onUnauthorized);
}

export function getSettings(onUnauthorized: () => void) {
  return call<ApiSettings>("/api/webmail/settings", undefined, onUnauthorized);
}

export function updateSettings(
  payload: {
    /** The display name on outgoing mail. The server refuses a blank one. */
    name?: string;
    signature_html?: string;
    signature_on_reply?: boolean;
    display_density?: "comfortable" | "compact";
    undo_send_enabled?: boolean;
    undo_send_seconds?: number;
  },
  onUnauthorized: () => void,
) {
  return call<Partial<ApiSettings>>(
    "/api/webmail/settings",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
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
  return call<ApiSecurity>("/api/webmail/security", undefined, onUnauthorized);
}

export function beginTwoFactor(onUnauthorized: () => void) {
  return call<ApiTwoFactorEnrolment>(
    "/api/webmail/security/2fa/begin",
    { method: "POST" },
    onUnauthorized,
  );
}

export function confirmTwoFactor(code: string, onUnauthorized: () => void) {
  return call<{ two_factor_enabled: boolean }>(
    "/api/webmail/security/2fa/confirm",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    },
    onUnauthorized,
  );
}

export function disableTwoFactor(code: string, onUnauthorized: () => void) {
  return call<{ two_factor_enabled: boolean }>(
    "/api/webmail/security/2fa/disable",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    },
    onUnauthorized,
  );
}

export function listSessions(onUnauthorized: () => void) {
  return call<{ scope: string; sessions: ApiSession[] }>(
    "/api/webmail/security/sessions",
    undefined,
    onUnauthorized,
  );
}

export function revokeSession(id: string, onUnauthorized: () => void) {
  return call<null>(
    `/api/webmail/security/sessions/${encodeURIComponent(id)}`,
    { method: "DELETE" },
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
  match?: "all" | "any";
  enabled?: boolean;
  conditions: Array<{ field: string; operator?: string; value?: string }>;
  actions: Array<{ type: string; value?: string }>;
}

export function getForwarding(onUnauthorized: () => void) {
  return call<ApiForwarding>(
    "/api/webmail/forwarding",
    undefined,
    onUnauthorized,
  );
}

export function updateForwarding(
  payload: Omit<ApiForwarding, "managed">,
  onUnauthorized: () => void,
) {
  return call<ApiForwarding>(
    "/api/webmail/forwarding",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    onUnauthorized,
  );
}

export function getRules(onUnauthorized: () => void) {
  return call<{ rules: ApiRule[]; active: boolean; managed: boolean }>(
    "/api/webmail/rules",
    undefined,
    onUnauthorized,
  );
}

export function updateRules(rules: ApiRule[], onUnauthorized: () => void) {
  return call<{ rules: ApiRule[] }>(
    "/api/webmail/rules",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules }),
    },
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

/**
 * The saved responder, as the mail server actually reports it.
 *
 * This was typed `{ enabled, raw }` -- a shape it has never returned. There is
 * no `raw` key, and the four fields the settings form needs were all present
 * and simply not described, so the page could only ever restore the checkbox
 * and redrew everything else from its own defaults. `parse_vacation` in the
 * mail server is the authority for this shape.
 *
 * Nullable throughout: a mailbox with no responder yet has a script with no
 * markers, and every field comes back null.
 */
export function getVacation(onUnauthorized: () => void) {
  return call<{
    enabled: boolean;
    subject: string | null;
    message: string | null;
    start_date: string | null;
    end_date: string | null;
    /** False when the script was hand-edited outside this UI. */
    managed?: boolean;
  }>("/api/webmail/vacation", undefined, onUnauthorized);
}

export function updateVacation(
  payload: ApiVacation,
  onUnauthorized: () => void,
) {
  return call<{ enabled: boolean }>(
    "/api/webmail/vacation",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    onUnauthorized,
  );
}

export function aiCompose(
  instruction: string,
  existingDraft: string | undefined,
  onUnauthorized: () => void,
) {
  return call<{ draft: string }>(
    "/api/webmail/ai/compose",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction,
        existing_draft: existingDraft || undefined,
      }),
    },
    onUnauthorized,
  );
}

export function aiSummarize(id: string, onUnauthorized: () => void) {
  return call<{ summary: string }>(
    `/api/webmail/ai/summarize/${encodeURIComponent(id)}`,
    { method: "POST" },
    onUnauthorized,
  );
}

// --- Accounts on this browser --------------------------------------------

export interface AccountSummary {
  email: string;
  active: boolean;
  expires_at: string | null;
}

/** Every mailbox signed in on this browser. 200 with an empty list when none. */
export function listAccounts() {
  return call<{ accounts: AccountSummary[] }>(
    "/api/webmail-auth/accounts",
    { cache: "no-store" },
    () => {
      // The accounts endpoint never answers 401; nothing to redirect for.
    },
  );
}

/**
 * Make another signed-in mailbox the active one, then start over on the
 * inbox. A reload, not a state reset: every piece of mailbox state on the
 * page belongs to the previous account, and the compose windows' own
 * unload guard gets its say before anything is lost.
 */
export async function switchAccount(email: string): Promise<string | null> {
  const result = await call<{ accounts: AccountSummary[] }>(
    "/api/webmail-auth/accounts",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
    () => {},
  );
  if (!result.success) return result.message;
  forgetDisplayAddress();
  window.location.assign("/");
  return null;
}

/**
 * Sign out of the active mailbox, or of every mailbox on this browser.
 * Lands on the next account's inbox when one remains, else on the login page.
 */
export async function signOut(all = false): Promise<void> {
  const res = await fetch("/api/webmail-auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ all }),
  }).catch(() => null);
  const body = (await res?.json().catch(() => ({}))) as {
    data?: { remaining?: number };
  };
  forgetDisplayAddress();
  window.location.assign(body?.data?.remaining ? "/" : "/login");
}

/** The cached "whose mailbox is this" placeholder; must not outlive the account it describes. */
export function forgetDisplayAddress(): void {
  try {
    sessionStorage.removeItem("mailyte_mailbox_display");
  } catch {
    // Storage unavailable; nothing cached to forget.
  }
}

/** @deprecated Use signOut(); kept for callers that manage their own redirect. */
export async function logout() {
  await fetch("/api/webmail-auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ all: false }),
  });
}
