import Mention from '@tiptap/extension-mention';
import { NodeSelection } from '@tiptap/pm/state';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { WebmailContact, WebmailListItem, WebmailParticipant } from './types';
import { extractEmail, namePart, splitRecipients } from './recipients';

/**
 * @mentions in the message body (plans/21-mentions, phase M1).
 *
 * Typing `@` at the start of a word opens a list -- the people on the email
 * first, then contacts -- which narrows as you type; picking one inserts a pill and tells the window, which adds the
 * person to Cc (decision D2). The pill is written out with INLINE styles:
 * recipients' mail clients drop stylesheets, and a mention that arrives as
 * plain text in Outlook has lost the point.
 */

export type MentionPopup = {
  items: WebmailContact[];
  index: number;
  rect: DOMRect | null;
  select: (contact: WebmailContact) => void;
};

export type MentionOptions = {
  /** Read on every keystroke, so a list that loads late is still used. */
  getContacts: () => WebmailContact[];
  onMention: (contact: WebmailContact) => void;
  /** The editor draws the list; this only reports what to draw. */
  onPopup: (popup: MentionPopup | null) => void;
};

const MAX_SUGGESTIONS = 8;

/** Name or address contains the query, name-start matches first (D8). */
export function matchContacts(contacts: WebmailContact[], query: string): WebmailContact[] {
  const q = query.trim().toLowerCase();
  // A bare "@" opens the list straight away, so the person can arrow down
  // and pick without typing a letter first. The candidates arrive with the
  // people on the email first (mentionCandidates), which is who a bare "@"
  // is usually for.
  if (!q) {
    const seen = new Set<string>();
    return contacts
      .filter((c) => {
        const key = c.email.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_SUGGESTIONS);
  }
  const scored = contacts
    .map((c) => {
      const name = (c.name ?? '').toLowerCase();
      const email = c.email.toLowerCase();
      const words = name.split(/\s+/);
      const rank = words.some((w) => w.startsWith(q))
        ? 0
        : email.startsWith(q)
          ? 1
          : name.includes(q) || email.includes(q)
            ? 2
            : -1;
      // Anyone on the email outranks every contact: the person being
      // replied to must never sit below a namesake from the address book.
      return { c, rank: rank < 0 ? -1 : c.onThread ? rank : rank + 3 };
    })
    .filter((s) => s.rank >= 0)
    .sort((a, b) => a.rank - b.rank);

  const seen = new Set<string>();
  const out: WebmailContact[] = [];
  for (const { c } of scored) {
    const key = c.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}

/** What the recipient sees: a blue pill, styled inline for every client. */
const PILL_STYLE =
  'background-color:#e8eefe;color:#2748c9;border-radius:4px;padding:0 3px;font-weight:600;white-space:nowrap;text-decoration:none;';

export function mentionExtension({ getContacts, onMention, onPopup }: MentionOptions) {
  return Mention.extend({
    // Two-step Backspace (PRD 2.2): the first press after a pill selects it,
    // the second deletes it. TipTap's default removes it -- or turns it back
    // into "@" -- on one press, which is how a name disappears by accident.
    addKeyboardShortcuts() {
      return {
        Backspace: () => {
          const { state, view } = this.editor;
          const { selection } = state;
          if (selection instanceof NodeSelection && selection.node.type.name === this.name) {
            return false; // second press: let the default delete it
          }
          if (!selection.empty) return false;
          const before = selection.$from.nodeBefore;
          if (!before || before.type.name !== this.name) return false;
          const pos = selection.from - before.nodeSize;
          view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
          return true;
        },
      };
    },
  }).configure({
    HTMLAttributes: { class: 'mention' },
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    // data-type/data-id/data-label are what TipTap parses back, so a draft
    // reopens with its pills intact; data-mention is the address the send
    // path collects for the X-Mailyte-Mentions header.
    renderHTML: ({ node }) => [
      'span',
      {
        'data-type': 'mention',
        'data-id': node.attrs.id,
        'data-label': node.attrs.label,
        'data-mention': node.attrs.id,
        style: PILL_STYLE,
      },
      `@${node.attrs.label ?? node.attrs.id}`,
    ],
    suggestion: {
      char: '@',
      // Word start only (D4): "joel@techies.africa" typed in a sentence
      // must not open the list.
      allowedPrefixes: [' ', '(', ' '],
      allowSpaces: false,
      items: ({ query }) => matchContacts(getContacts(), query),
      command: ({ editor, range, props }) => {
        const contact = props as unknown as WebmailContact;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: 'mention', attrs: { id: contact.email, label: contact.name?.trim() || contact.email } },
            { type: 'text', text: ' ' },
          ])
          .run();
        onMention(contact);
      },
      render: () => {
        let index = 0;
        let current: SuggestionProps<WebmailContact> | null = null;

        const publish = () => {
          if (!current || current.items.length === 0) {
            onPopup(null);
            return;
          }
          const props = current;
          onPopup({
            items: props.items,
            index,
            rect: props.clientRect?.() ?? null,
            select: (contact) => props.command(contact as never),
          });
        };

        return {
          onStart: (props) => {
            current = props as SuggestionProps<WebmailContact>;
            index = 0;
            publish();
          },
          onUpdate: (props) => {
            current = props as SuggestionProps<WebmailContact>;
            index = Math.min(index, Math.max(0, current.items.length - 1));
            publish();
          },
          onKeyDown: ({ event }: SuggestionKeyDownProps) => {
            if (!current || current.items.length === 0) return false;
            const count = current.items.length;
            if (event.key === 'ArrowDown') {
              index = (index + 1) % count;
              publish();
              return true;
            }
            if (event.key === 'ArrowUp') {
              index = (index - 1 + count) % count;
              publish();
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              current.command(current.items[index] as never);
              return true;
            }
            if (event.key === 'Escape') {
              onPopup(null);
              current = null;
              return true;
            }
            return false;
          },
          onExit: () => {
            current = null;
            onPopup(null);
          },
        };
      },
    },
  });
}

/** The addresses mentioned in a body, for the X-Mailyte-Mentions header. */
export function mentionedAddresses(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/data-mention="([^"]+)"/g)) {
    const email = m[1].trim().toLowerCase();
    if (email.includes('@')) found.add(email);
  }
  return [...found];
}

function listed(value: string): Set<string> {
  return new Set(splitRecipients(value).map((e) => extractEmail(e).toLowerCase()));
}

/**
 * The Cc value after mentioning `contact`, or null when they are already on
 * To, Cc or Bcc (D2, D5 -- no duplicate). Removing the pill later does not
 * take them off again (D6).
 */
export function ccWithMention(
  recipients: { to: string; cc: string; bcc: string },
  contact: WebmailContact,
): string | null {
  const email = contact.email.toLowerCase();
  const all = new Set([...listed(recipients.to), ...listed(recipients.cc), ...listed(recipients.bcc)]);
  if (all.has(email)) return null;
  const entry = contact.name?.trim() ? `${contact.name.trim()} <${contact.email}>` : contact.email;
  const cc = recipients.cc.trim();
  return cc ? `${cc.replace(/[,;]\s*$/, '')}, ${entry}` : entry;
}

/** Mentioned people who are on Bcc: the pill names them to everyone (D1). */
export function mentionedOnBcc(body: string, bcc: string): string[] {
  const hidden = listed(bcc);
  return mentionedAddresses(body).filter((email) => hidden.has(email));
}

/**
 * Who the @ list offers, in order: the people on this email first, then
 * contacts.
 *
 * It used to offer contacts only, so replying to someone who was not a saved
 * contact -- the sender of the very message on screen -- found nobody at
 * "@Oluwatoyin" (2026-09-28). The sender, Reply-To, To and Cc of the message
 * being answered, plus whoever is in the draft's own To/Cc/Bcc, come first;
 * a thread person without a display name borrows their contact card's name.
 * The writer is left out: nobody mentions themselves.
 */
export function mentionCandidates({
  message,
  recipients,
  selfAddress,
  contacts,
}: {
  message?: Pick<WebmailListItem, 'from' | 'fromEmail' | 'to' | 'cc'> & { replyTo?: WebmailParticipant[] } | null;
  recipients?: { to?: string; cc?: string; bcc?: string };
  selfAddress?: string;
  contacts: WebmailContact[];
}): WebmailContact[] {
  const self = (selfAddress ?? '').trim().toLowerCase();
  const cardName = new Map(contacts.map((c) => [c.email.toLowerCase(), c.name]));
  const people = new Map<string, WebmailContact>();

  const add = (name: string | null | undefined, email: string | null | undefined) => {
    const address = (email ?? '').trim();
    const key = address.toLowerCase();
    if (!key.includes('@') || key === self || people.has(key)) return;
    const shown = name?.trim() && name.trim().toLowerCase() !== key ? name.trim() : cardName.get(key) ?? null;
    people.set(key, { name: shown, email: address, onThread: true });
  };

  if (message) {
    add(message.from, message.fromEmail);
    for (const p of message.replyTo ?? []) add(p.name, p.email);
    for (const p of message.to) add(p.name, p.email);
    for (const p of message.cc) add(p.name, p.email);
  }
  for (const field of [recipients?.to, recipients?.cc, recipients?.bcc]) {
    for (const entry of splitRecipients(field ?? '')) add(namePart(entry), extractEmail(entry));
  }

  return [...people.values(), ...contacts];
}

/**
 * Which mentions appeared or disappeared since the body was last seen.
 *
 * A mention that ADDED someone to Cc now takes them off again when its pill
 * is deleted, and puts them back if Undo restores it (2026-09-28: mention
 * Kanu, delete, mention Joel used to leave both on Cc). Only transitions are
 * acted on -- never the steady state -- so hand-editing the Cc field is not
 * fought over on every keystroke.
 */
export function mentionTransitions(
  previous: Set<string>,
  html: string,
): { present: Set<string>; removed: string[]; restored: string[] } {
  const present = new Set(mentionedAddresses(html));
  return {
    present,
    removed: [...previous].filter((email) => !present.has(email)),
    restored: [...present].filter((email) => !previous.has(email)),
  };
}

/** `value` without the entries whose address is in `emails` (lowercase). */
export function withoutRecipients(value: string, emails: Set<string>): string {
  return splitRecipients(value)
    .filter((entry) => !emails.has(extractEmail(entry).toLowerCase()))
    .join(', ');
}

/** The Cc entry a mention writes: "Name <email>" or the bare address. */
export function mentionEntry(contact: WebmailContact): string {
  return contact.name?.trim() ? `${contact.name.trim()} <${contact.email}>` : contact.email;
}
