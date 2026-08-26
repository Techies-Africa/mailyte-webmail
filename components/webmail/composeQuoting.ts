// Reply/forward header construction, kept out of the compose component so
// the rules are readable and testable as plain functions.
//
// Every one of these existed as an inline expression in the forked demo
// component and every one of them was subtly wrong (PRD SS2 E5): Reply-All
// quoted nothing because the quote branch only checked `mode === 'reply'`;
// subjects stacked up as "Re: Re: Re:"; and a forward printed the literal
// string "[Original Recipients]" into the message body.

import type { ComposeMode, WebmailMessage, WebmailParticipant } from './types';

export function formatParticipant(p: WebmailParticipant): string {
  if (!p.email) return '';
  return p.name ? `${p.name} <${p.email}>` : p.email;
}

export function formatParticipants(list: WebmailParticipant[]): string {
  return list.map(formatParticipant).filter(Boolean).join(', ');
}

export function addressList(list: WebmailParticipant[]): string {
  return list.map((p) => p.email).filter(Boolean).join(', ');
}

/**
 * "Re: Re: Fwd: hello" -> "Re: hello". RFC 5322 SS3.6.5 says a reply gets ONE
 * "Re: "; every mail client that stacks them is doing it wrong, and quoting a
 * stacked subject back propagates the mess to everyone else in the thread.
 */
export function replySubject(subject: string): string {
  const stripped = subject.replace(/^\s*((re|fwd|fw)\s*:\s*)+/i, '').trim();
  return `Re: ${stripped}`;
}

export function forwardSubject(subject: string): string {
  const stripped = subject.replace(/^\s*((re|fwd|fw)\s*:\s*)+/i, '').trim();
  return `Fwd: ${stripped}`;
}

/**
 * Reply-All recipients, per the conventional rules every mail client follows:
 * To = the message's Reply-To (if it set one) or its From; Cc = everyone else
 * who was on To/Cc, minus ourselves (replying to your own address is the
 * classic Reply-All embarrassment).
 */
export function replyAllRecipients(
  message: WebmailMessage,
  selfAddress: string,
): { to: string; cc: string } {
  const self = selfAddress.toLowerCase();
  const primary = message.replyTo.length > 0 ? message.replyTo : [{ name: message.from, email: message.fromEmail }];

  const seen = new Set<string>(primary.map((p) => p.email.toLowerCase()));
  seen.add(self);

  const others = [...message.to, ...message.cc].filter((p) => {
    const key = p.email.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { to: addressList(primary), cc: addressList(others) };
}

export function replyRecipients(message: WebmailMessage): string {
  const primary = message.replyTo.length > 0 ? message.replyTo : [{ name: message.from, email: message.fromEmail }];
  return addressList(primary);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The quoted original, as HTML placed below two blank lines so the caret can
 * sit above it. Used for reply AND replyAll -- the missing `replyAll` case is
 * exactly the E5 bug.
 */
export function quotedBody(mode: ComposeMode, message: WebmailMessage): string {
  const when = message.timestamp.toLocaleString();

  if (mode === 'reply' || mode === 'replyAll') {
    const who = escapeHtml(formatParticipant({ name: message.from, email: message.fromEmail }));
    return (
      '<p><br></p><p><br></p>' +
      `<p>On ${escapeHtml(when)}, ${who} wrote:</p>` +
      `<blockquote style="border-left:2px solid #ccc;padding-left:10px;margin-left:5px;color:#666;">${message.body}</blockquote>`
    );
  }

  if (mode === 'forward') {
    const rows = [
      `From: ${escapeHtml(formatParticipant({ name: message.from, email: message.fromEmail }))}`,
      `Date: ${escapeHtml(when)}`,
      `Subject: ${escapeHtml(message.subject)}`,
      // The real recipients, read off the message's own headers. The demo
      // printed the literal placeholder "[Original Recipients]" here.
      message.to.length ? `To: ${escapeHtml(formatParticipants(message.to))}` : null,
      message.cc.length ? `Cc: ${escapeHtml(formatParticipants(message.cc))}` : null,
    ].filter(Boolean);

    return (
      '<p><br></p><p><br></p>' +
      '<p>---------- Forwarded message ---------</p>' +
      rows.map((r) => `<p>${r}</p>`).join('') +
      '<p><br></p>' +
      message.body
    );
  }

  return '';
}
