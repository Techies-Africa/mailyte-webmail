/**
 * Separating what someone just wrote from the thread they wrote it under.
 *
 * A reply carries the whole conversation inside itself: every previous message
 * is quoted in the body of the next one. Rendered in full, a long support
 * thread is mostly history -- the two new sentences sit at the top and several
 * screens of quoted text follow them. Gmail hides that behind a small "..."
 * button, and this is the same idea: find where the new writing stops and the
 * quoted history begins, so the frame can collapse the second part.
 *
 * The split is deliberately conservative. Getting it wrong in one direction is
 * invisible (the message renders as it always did); getting it wrong in the
 * other hides something the sender actually wrote. So every rule here only
 * ever collapses a run of quoted material at the END of a message, and the
 * guards below refuse the split outright rather than guess.
 *
 * There is no single marker to look for, because every mail client quotes
 * differently -- Gmail's `.gmail_quote`, Apple Mail's `blockquote[type=cite]`,
 * Outlook's `#divRplyFwdMsg` and its row of underscores, Thunderbird's
 * `.moz-cite-prefix`. QUOTE_ROOTS collects the ones worth recognising by name,
 * and a bare `<blockquote>` catches the rest, which is what most clients
 * (including our own composer) end up emitting anyway.
 */

/**
 * Hooks a mail client writes for its own use, which mean quoted history and
 * nothing else. Because they are unambiguous, finding one anywhere makes
 * everything after it history -- which is how Outlook has to be read: it drops
 * a #divRplyFwdMsg header block and then simply carries on with the quoted
 * message in ordinary divs, so there is no quote element at the end to find.
 */
const QUOTE_MARKERS = [
  '.gmail_quote',
  '.gmail_quote_container',
  '.moz-cite-prefix',
  '.yahoo_quoted',
  '.protonmail_quote',
  '#divRplyFwdMsg',
  '#appendonsend',
  '#mail-editor-reference-message-container',
  '.OutlookMessageHeader',
].join(',');

/**
 * The above, plus a bare <blockquote>. A blockquote is held to the stricter
 * rule -- it has to end the message -- because unlike the markers it has an
 * honest second job: quoting something in the middle of a sentence.
 */
const QUOTE_ROOTS = `blockquote,${QUOTE_MARKERS}`;

/**
 * The line that introduces a quote -- "On Tuesday, X wrote:", Outlook's header
 * block, a forwarding banner. It belongs with the history rather than with the
 * new message, so it collapses too; leaving it behind would strand a dangling
 * "wrote:" above the button.
 */
const ATTRIBUTION = [
  /^on\b[\s\S]{0,300}\bwrote:$/i,
  /^-{2,}\s*(original message|forwarded message)\s*-{2,}/i,
  /^_{5,}$/,
  /^(from|sent|to|cc|subject|date)\s*:/i,
];

/** Below this the history is short enough that a button to reveal it is the bigger nuisance. */
const MIN_QUOTED_CHARS = 200;

export type SplitBody = {
  /** What the sender wrote, shown as normal. */
  visible: string;
  /** The thread underneath it, or null when there is nothing worth collapsing. */
  quoted: string | null;
};

/**
 * Split sanitised message HTML into the new part and the quoted part.
 *
 * Returns everything as `visible` -- never throws, never drops content -- when
 * there is no quoted run to find, when the split would leave nothing on screen,
 * or when there is no DOM to parse with (this runs during SSR too).
 */
export function splitQuotedHistory(html: string): SplitBody {
  if (typeof document === 'undefined' || !html) return { visible: html, quoted: null };

  // A <template> is inert: setting innerHTML on one parses the markup without
  // fetching an image or applying a style. The input is already sanitised, and
  // this keeps it from touching the network a second time on the way through.
  const template = document.createElement('template');
  template.innerHTML = html;
  const nodes = Array.from(template.content.childNodes);
  if (nodes.length === 0) return { visible: html, quoted: null };

  // A client's own marker settles it wherever it appears: take the first, so a
  // chain of them collapses as one.
  let start = nodes.findIndex((node) => isElement(node) && node.matches(QUOTE_MARKERS));

  // Otherwise look for a quote that ENDS the message. Skipping blank nodes on
  // the way back lets a message end with stray <br>s, as plenty do; anything
  // else with real content means the sender wrote below the quote, and a
  // message that is bottom-posted or interleaved is left entirely alone.
  if (start === -1) {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (isIgnorable(nodes[i])) continue;
      if (isQuoteRoot(nodes[i])) start = i;
      break;
    }
  }
  if (start === -1) return { visible: html, quoted: null };

  // Absorb the attribution line, and any further quotes stacked above it: a
  // chain quoted one level at a time is a run of siblings, not a single node.
  let from = start;
  while (from > 0) {
    const previous = nodes[from - 1];
    if (isIgnorable(previous) || isQuoteRoot(previous) || isAttribution(previous)) {
      from -= 1;
      continue;
    }
    break;
  }

  const visibleNodes = nodes.slice(0, from);
  const quotedNodes = nodes.slice(from);

  // Two refusals, both about not making the message worse than it was.
  // Nothing left on top means the whole body is quoted -- a bare forward, say
  // -- and collapsing it would open the message onto an empty sheet and a
  // button. A short quote is cheaper to read than to click.
  if (!hasVisibleContent(visibleNodes)) return { visible: html, quoted: null };
  if (textLength(quotedNodes) < MIN_QUOTED_CHARS) return { visible: html, quoted: null };

  return { visible: serialise(visibleNodes), quoted: serialise(quotedNodes) };
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function isQuoteRoot(node: Node): boolean {
  if (!isElement(node)) return false;
  if (node.matches(QUOTE_ROOTS)) return true;
  // Several clients post the quote inside a plain wrapper div with nothing of
  // their own in it. That wrapper is the quote for our purposes.
  return (
    node.tagName === 'DIV' &&
    node.children.length === 1 &&
    node.children[0].matches(QUOTE_ROOTS) &&
    !directText(node)
  );
}

function isAttribution(node: Node): boolean {
  if (node.nodeType === 3) return matchesAttribution(node.textContent ?? '');
  if (!isElement(node)) return false;
  if (node.tagName === 'STYLE' || node.tagName === 'SCRIPT') return false;
  if (node.tagName === 'HR') return true;
  if (node.matches('.gmail_attr, .moz-cite-prefix')) return true;
  const text = (node.textContent ?? '').trim();
  // Long enough to be prose is long enough to be the sender's own words.
  if (text.length > 400) return false;
  return matchesAttribution(text);
}

function matchesAttribution(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  return ATTRIBUTION.some((pattern) => pattern.test(text));
}

/** Blank nodes: whitespace, comments, spacer <br>s and empty wrappers. */
function isIgnorable(node: Node): boolean {
  if (node.nodeType === 3) return !(node.textContent ?? '').trim();
  if (node.nodeType === 8) return true;
  if (!isElement(node)) return false;
  if (node.tagName === 'STYLE' || node.tagName === 'SCRIPT') return false;
  if (node.tagName === 'BR') return true;
  // An empty <p> holding a picture is not empty.
  if (node.querySelector('img')) return false;
  return !(node.textContent ?? '').trim();
}

/** Text belonging to this element itself rather than to a child. */
function directText(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
}

function hasVisibleContent(nodes: Node[]): boolean {
  return nodes.some(
    (node) =>
      (node.textContent ?? '').trim().length > 0 ||
      (isElement(node) && (node.tagName === 'IMG' || node.querySelector('img') !== null)),
  );
}

function textLength(nodes: Node[]): number {
  return nodes.reduce((total, node) => total + (node.textContent ?? '').trim().length, 0);
}

function serialise(nodes: Node[]): string {
  const box = document.createElement('div');
  for (const node of nodes) box.appendChild(node.cloneNode(true));
  return box.innerHTML;
}
