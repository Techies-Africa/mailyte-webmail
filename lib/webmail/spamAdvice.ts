import type { SpamReason } from '@/components/webmail/types';

/**
 * Short, plain advice for a spam score.
 *
 * The mail server explains a score in terms written for people who run mail
 * for a company (SPF, DMARC, "plain-text version", "see Domains"). Someone
 * reading their own sent mail should not have to know any of that, or read a
 * paragraph about it. So the reasons are folded into a few things they can DO,
 * each one line: the action, and at most a few words of hint. Anything
 * technical is kept, but only as "details for your admin".
 *
 * Grouping is by the server's rule name, in the order the server ranked them
 * (worst first). A rule this table does not know about is never dropped: it
 * lands under "Other things to check" with the server's own wording.
 */

export interface SpamAdvice {
  id: string;
  /** Who can fix it: the person writing the email, or whoever manages their domain. */
  who: 'you' | 'admin';
  /** The action, a few words. */
  title: string;
  /** A few words more, optional. */
  hint?: string;
  /** The server's own reasons behind this item (shown to admins, never as the headline). */
  reasons: SpamReason[];
}

interface Group {
  id: string;
  who: 'you' | 'admin';
  title: string;
  hint?: string;
  match: RegExp;
}

const GROUPS: Group[] = [
  {
    id: 'setup',
    who: 'admin',
    title: 'Ask your IT admin to check your email setup',
    match: /^(R_SPF_\w+|DMARC_\w+|R_DKIM_\w+|DKIM_\w+)$/,
  },
  {
    id: 'links',
    who: 'you',
    title: 'Remove suspicious or shortened links',
    match: /^(PHISHING|R_SUSPICIOUS_URL|SUSPICIOUS_URL_IN_SUSPICIOUS_MESSAGE|URIBL_\w+|SURBL_\w+|DBL_\w+|REDIRECTOR_URL)$/,
  },
  {
    id: 'hidden',
    who: 'you',
    title: 'Remove hidden text',
    hint: 'tiny, or the same colour as the background',
    match: /^(ZERO_FONT|MANY_INVISIBLE_PARTS|R_WHITE_ON_WHITE)$/,
  },
  {
    id: 'pictures',
    who: 'you',
    title: 'Add some written text',
    hint: 'not just pictures',
    match: /^(HTML_IMAGE_ONLY_\d+|R_EMPTY_IMAGE|HTML_SHORT_\d|HTML_SHORT_LINK_IMG_\d)$/,
  },
  {
    id: 'subject',
    who: 'you',
    title: 'Fix the subject line',
    hint: 'no ALL CAPS, "!" or prices',
    match: /^(MISSING_SUBJECT|EMPTY_SUBJECT|SUBJ_\w+|SUBJECT_\w+)$/,
  },
  {
    id: 'wording',
    who: 'you',
    title: 'Write it more naturally',
    hint: 'avoid "free" and "act now"',
    match: /^(BAYES_SPAM|FUZZY_\w+)$/,
  },
  {
    id: 'sender',
    who: 'you',
    title: 'Send and reply from one address',
    hint: 'on your own domain, not Gmail',
    match: /^(FREEMAIL_\w+|REPLYTO_DOM_NEQ_FROM_DOM|FORGED_SENDER|FROM_NEQ_ENVFROM)$/,
  },
  {
    id: 'layout',
    who: 'you',
    title: 'Use a simpler layout',
    match: /^(HAS_DATA_URI|EXT_CSS|URI_COUNT_ODD|MIME_HTML_ONLY\w*|R_PARTS_DIFFER)$/,
  },
  {
    id: 'urgent',
    who: 'you',
    title: "Don't mark it urgent",
    match: /^HAS_X_PRIO_ONE$/,
  },
];

/** Reasons grouped into things to do, in the order the server ranked them. */
export function spamAdvice(reasons: SpamReason[]): SpamAdvice[] {
  const byId = new Map<string, SpamAdvice>();
  const order: string[] = [];

  for (const reason of reasons) {
    const known = GROUPS.find((g) => g.match.test(reason.rule));
    // A rule we do not know: the server's own wording, never dropped. Setup
    // problems are always for the admin, whatever they are called.
    const group: Group =
      known ?? (reason.kind === 'setup' ? GROUPS[0] : { id: 'other', who: 'you', title: 'Other things to check', match: /$^/ });
    let item = byId.get(group.id);
    if (!item) {
      item = { id: group.id, who: group.who, title: group.title, hint: group.hint, reasons: [] };
      byId.set(group.id, item);
      order.push(group.id);
    }
    item.reasons.push(reason);
  }
  return order.map((id) => byId.get(id) as SpamAdvice);
}
