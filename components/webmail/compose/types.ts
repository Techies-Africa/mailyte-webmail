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
  layout: ComposeLayout;
  /** What the title bar and the minimized tab show; follows the subject. */
  label: string;
  /** Bumped to remount the window when its content is replaced from outside. */
  seed: number;
}

/** A sender this window may write as. */
export interface FromOption {
  address: string;
  name: string | null;
}
