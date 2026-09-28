import Mention from '@tiptap/extension-mention';
import { NodeSelection } from '@tiptap/pm/state';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { WebmailContact } from './types';
import { extractEmail, splitRecipients } from './recipients';

/**
 * @mentions in the message body (plans/21-mentions, phase M1).
 *
 * Typing `@` at the start of a word and one more character opens a list of
 * contacts; picking one inserts a pill and tells the window, which adds the
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
  if (!q) return [];
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
      return { c, rank };
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
