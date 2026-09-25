import type { ComposeDraft, ComposeMode, WebmailMessage } from '../types';

export type ComposePayload = ComposeDraft & {
  inReplyTo?: string;
  references?: string;
  attachments?: File[];
  /** ISO-8601 instant for a scheduled send. Absent means send now. */
  sendAt?: string;
  /** Send as a shared mailbox address the session may send from. */
  from?: string;
  /**
   * The draft this message was autosaved as. It is removed once the message
   * has actually gone -- not before, so an Undo or a failed send still has it.
   */
  draftId?: string;
};

export type ComposeLayout = 'open' | 'minimized' | 'fullscreen';

/**
 * One compose window.
 *
 * The redesign allows several at once -- a reply half-written while a new
 * message is started -- so the compose state is a list of these rather than
 * one `{ open, mode }` object. Each carries everything the window needs to
 * rebuild itself, which is also what lets an undone send reopen exactly.
 *
 * The list's order is the dock's slot order: index 0 nearest the right edge,
 * a new window appended at the left end (see dockLayout).
 */
export interface ComposeWindow {
  id: string;
  mode: ComposeMode;
  replyTo?: WebmailMessage;
  /** HTML the editor starts with (a resumed draft, an AI body, a signature). */
  initialBody?: string;
  /** Set when resuming an existing draft, so saving supersedes it. */
  draftId?: string;
  /** Header fields restored into the window. */
  resumed?: { to: string; cc: string; bcc: string; subject: string };
  /** Files, From and flags for a message put back by Undo or Reopen; see OpenComposeOptions. */
  attachments?: File[];
  from?: string;
  quoteIncluded?: boolean;
  restored?: boolean;
  threading?: { inReplyTo?: string; references?: string };
  /**
   * Its shape only, never its place: a minimized window keeps its slot in the
   * dock, drawn there as a tab, and stays mounted, so nothing typed or
   * attached in it is lost.
   */
  layout: ComposeLayout;
  /** What the title bar and the minimized tab show; follows the subject. */
  label: string;
  /** The To line as it stands, reported by the window: the minimized tab names who the message is for. */
  to: string;
  /** Bumped to remount the window when its content is replaced from outside. */
  seed: number;
  /**
   * When the window was last opened, restored, focused or pressed (a running
   * count, not a clock). On a phone only one window fits, and it is the one
   * touched last. On a desktop it decides which window draws on top and which
   * collapses first when the row runs out of room -- never where one sits.
   */
  activatedAt: number;
  /**
   * When it was opened, on the same count. The dock renders windows in this
   * order, which never changes: a drag reorders the slots (the array), never
   * the DOM. A re-inserted node would replay its rise animation and drop the
   * focus of whatever was being typed in it.
   */
  created: number;
}

/** A sender this window may write as. */
export interface FromOption {
  address: string;
  name: string | null;
}
