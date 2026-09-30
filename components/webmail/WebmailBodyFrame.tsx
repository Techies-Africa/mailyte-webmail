import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { ImageOff } from 'lucide-react';
import { sanitizeEmailHtml } from '@/lib/webmail/sanitize';
import { splitQuotedHistory } from '@/lib/webmail/quotedHistory';
import { DRAGGING_ATTR, PANE_RESIZE_END_EVENT } from '@/lib/webmail/paneLayout';
import type { WebmailAttachment } from './types';

// Renders a message body in a sandboxed iframe rather than injecting it into
// the page. Two real problems that fixes: (1) an email's own embedded CSS
// routinely overrides this page's light/dark theme, producing unreadable
// white-on-white text; (2) third-party HTML in the page is a live XSS surface
// (event-handler attributes, javascript: hrefs) -- `sandbox` blocks scripts
// and top-level navigation from content we don't control.
//
// `allow-same-origin` (but deliberately NOT `allow-scripts`) is required: a
// bare `sandbox=""` gives the frame an opaque origin and the parent's height
// measurement below then throws a cross-origin error. The sandbox escape
// browsers guard against needs both flags together; withholding
// `allow-scripts` means no script in the frame ever runs.
//
// `allow-popups allow-popups-to-escape-sandbox` exist for the reader's sake:
// the sanitiser rewrites every link to target="_blank", and without
// `allow-popups` the sandbox silently swallows exactly those clicks -- every
// button and link in every message was dead, with no error anywhere.
// `allow-popups-to-escape-sandbox` keeps the opened tab from inheriting this
// frame's sandbox (an inherited no-scripts sandbox renders most sites
// broken-blank). Still withheld: `allow-scripts` (nothing executes in the
// frame, so no script can call window.open -- only a real user click on a
// link opens anything) and `allow-top-navigation` (a message can never
// navigate the mail client itself away).
//
// As of M-C the HTML is also run through DOMPurify before it gets here (PRD
// SS7.1) -- the sandbox stops script executing, the sanitiser stops it being
// in the document at all. Two independent layers, which is what "defence in
// depth" was supposed to mean when only the iframe existed.
/**
 * Two kinds of message, two different answers.
 *
 * **HTML mail renders on white, untouched, in both themes.** It is authored
 * against a light background and paints its own -- a white card, a table with
 * a white cell -- but usually leaves the text colour to be inherited. Nothing
 * here can know which of the sender's colours were meant for a light ground
 * and which would survive inversion, so the safe answer is not to try. Every
 * major mail client does the same.
 *
 * That used to mean dimming the whole frame with `filter: brightness()`, on
 * the reasoning that pure white against a 4%-lightness page is a lightbox in
 * the middle of the screen. It is, but the cure was worse: a designed
 * template came out muddy and grey, its brand colours flattened, looking
 * broken rather than dark. A filter cannot distinguish "the sender's white
 * background" from "the sender's photograph". So HTML is now left exactly as
 * the sender built it, and the frame simply reads as a white card on a dark
 * page -- which is what Gmail and Apple Mail show too.
 *
 * **Plain text is ours, so it follows the theme properly.** A message with no
 * HTML part is wrapped by `textToSafeHtml` -- we author every pixel of it,
 * there is no sender CSS to fight, and a white sheet holding three lines of
 * text is the case where the lightbox complaint was actually right. So in
 * dark mode it gets a real dark background and light text, matching the page.
 *
 * That distinction is the whole design: recolouring is unsafe for HTML
 * precisely because the sender painted their own background, and perfectly
 * safe for plain text because we painted it.
 *
 * `color-scheme` follows the same split, so the browser's form controls and
 * scrollbars inside the frame match whichever surface they sit on.
 *
 * **Wide mail is scaled to fit, not cut off.** A template built on a fixed
 * 600-650px table (GitHub's invitation, most newsletters) cannot shrink below
 * that -- `max-width` does not narrow an auto-layout table past its
 * min-content width -- and the frame's `overflow-x: hidden` then cut its
 * right side off on a phone. So the message sits in a `<mailyte-fit>`
 * wrapper (a custom element, so no sender rule for `div` can reach it), and
 * when its natural width is wider than the frame the wrapper is zoomed down
 * to fit (fit() below):
 *
 * - `zoom`, not `transform: scale()`: zoom changes layout, so the body's
 *   height -- what measure() sizes the frame by -- is the scaled height, with
 *   no bounding-box arithmetic.
 * - Measured at natural size: the previous scale is removed first, or the
 *   last pass would feed this one (the same trap as measure()).
 * - Never below MIN_FIT_SCALE; past that, and where zoom is unsupported, the
 *   wrapper scrolls sideways instead. Panning beats both clipping and text
 *   too small to read.
 * - Mail that is already responsive never scales: its `@media` rules see
 *   the frame's own width and lay it out to fit, so it is never too wide.
 *
 * **A long reply chain must not squeeze itself to nothing.** Each reply wraps
 * the one before it in a `<blockquote>`, and the browser's default for that is
 * `margin: 1em 40px` -- 80px of width gone per level. A dozen replies deep (a
 * support thread, a forwarded chain) the text was down to a couple of
 * characters, breaking one per line, and eventually to zero width.
 *
 * Note that fit() cannot rescue this, which is why the reset has to prevent it:
 * `overflow-wrap: anywhere` below lets text wrap mid-word, so a starved column
 * reports no overflow -- scrollWidth stays equal to clientWidth and the message
 * measures as fitting perfectly while being unreadable. Wide mail announces
 * itself; a strangled quote chain does not.
 *
 * **The thread underneath is collapsed, not shown.** Capping the indent stops
 * a reply chain destroying itself, but it is still there: open a long support
 * thread and the two new sentences sit above several screens of history every
 * reader has already read. So splitQuotedHistory() finds where the new writing
 * stops, and everything after it goes behind a small button, the way Gmail
 * does it.
 *
 * The switch is a checkbox and a `<label>`, which looks archaic until you
 * remember this frame has no `allow-scripts`: nothing in it can run, so
 * `:checked` is the only state a reader can change from inside. Doing it this
 * way keeps the button where it belongs, in the flow of the message and above
 * the quote -- a React control outside the frame would sit under the whole
 * thing once expanded -- and it costs no second frame, so the sender's own
 * stylesheet still reaches the quoted half. Expanding changes the body's
 * height, which the ResizeObserver in attach() already watches.
 */
function emailSafeReset(darkPlainText: boolean) {
  const surface = darkPlainText
    // The app's own dark tokens, so the frame is continuous with the page
    // behind it rather than a near-miss shade floating on top of it.
    ? {
        scheme: 'dark', bg: 'hsl(240 10% 4%)', fg: 'hsl(0 0% 98%)', link: '#8b84ff',
        chip: 'hsl(240 5% 16%)', chipBorder: 'hsl(240 5% 32%)', chipHover: 'hsl(240 5% 22%)',
      }
    : {
        scheme: 'light', bg: 'white', fg: '#111827', link: '#3730a3',
        chip: '#f1f3f5', chipBorder: '#d0d7de', chipHover: '#e3e6ea',
      };

  return `<style>
  :root { color-scheme: ${surface.scheme}; }
  html, body { max-width: 100%; overflow-x: hidden; background: ${surface.bg}; color: ${surface.fg}; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  /* Only ever reached by plain text, where we wrote the markup -- an HTML
     sender's own link colours are never overridden. */
  a { color: ${surface.link}; }
  /* The frame is sized to the body's height, so the body's height must never
     depend on the frame's -- a message shipping "body { height: 100% }"
     would otherwise resolve to the viewport and grow every time we resized
     to fit it. See the measure() comment below. */
  html, body { height: auto !important; min-height: 0 !important; min-width: 0 !important; }
  /* The scaling wrapper; see "Wide mail" above. It, not the body, is what
     clips or scrolls sideways, so its scrollWidth is the content's width. */
  mailyte-fit { display: block; overflow-x: hidden; }
  /* One long line in a <pre> would otherwise shrink the whole message to its
     width. Wrapped, it reads at full size, as other mail clients show it. */
  pre { white-space: pre-wrap !important; }
  /* Quoted replies; see "A long reply chain" above. The browser's default is
     "margin: 1em 40px", so every level of quoting costs 80px of width. Indent
     the left only, by about what Gmail uses, and !important because senders
     inline their own margins (a bare 40px is common, and beats a plain rule). */
  blockquote { margin-left: 0.8ex !important; margin-right: 0 !important; padding-left: 1ex !important; }
  /* Past the fourth level, stop indenting altogether: a fifth blockquote adds
     nothing a reader can still follow, and without a stop the text runs out of
     width no matter how small each step is. Matching "five deep" bounds the
     total indent rather than slowing its growth. */
  blockquote blockquote blockquote blockquote blockquote {
    margin-left: 0 !important; padding-left: 0 !important; border-left: 0 !important;
  }
  /* The collapsed thread; see "The thread underneath" above. A custom element
     and deliberately unlikely class names, so no rule a sender wrote for div
     or label can reach them, and !important for the ones that would break the
     control rather than merely restyle it. */
  mailyte-quote { display: none; }
  .mailyte-quote-switch:checked ~ mailyte-quote { display: block; }
  /* Hidden from view but NOT from the keyboard: display:none would take the
     checkbox out of the tab order, and since it is the only switch there is,
     the thread would become impossible to open without a mouse. */
  .mailyte-quote-switch {
    position: absolute !important; width: 1px !important; height: 1px !important;
    margin: 0 !important; padding: 0 !important; border: 0 !important;
    clip-path: inset(50%) !important; overflow: hidden !important; white-space: nowrap !important;
  }
  .mailyte-quote-switch:focus-visible ~ .mailyte-quote-btn {
    outline: 2px solid ${surface.link} !important; outline-offset: 2px !important;
  }
  /* It says what it does. Gmail's bare "..." only reads as a control if you
     already know Gmail; here the button carries its own label and a caret, so
     there is nothing to recognise or guess at. */
  .mailyte-quote-btn {
    display: inline-flex !important; align-items: center !important; gap: 7px !important;
    margin: 14px 0 !important; padding: 7px 13px !important;
    background: ${surface.chip} !important; color: ${surface.link} !important;
    border: 1px solid ${surface.chipBorder} !important; border-radius: 7px !important;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
    font-size: 13px !important; font-weight: 600 !important; font-style: normal !important;
    line-height: 1.3 !important; letter-spacing: 0 !important; text-align: left !important;
    text-decoration: none !important; text-transform: none !important;
    cursor: pointer; user-select: none; -webkit-user-select: none; white-space: nowrap !important;
  }
  .mailyte-quote-btn:hover { background: ${surface.chipHover} !important; }
  /* A caret, drawn rather than typed: a glyph would depend on a font the
     sender may have replaced. It points down to open and up to close. */
  .mailyte-quote-btn::after {
    content: "" !important; width: 0 !important; height: 0 !important; flex: none !important;
    border-left: 4px solid transparent !important; border-right: 4px solid transparent !important;
    border-top: 5px solid currentColor !important;
  }
  .mailyte-quote-switch:checked ~ .mailyte-quote-btn::after {
    border-top: 0 !important; border-bottom: 5px solid currentColor !important;
  }
  /* Only one of the two labels is ever shown, which is how the button changes
     its wording without a line of script. */
  .mailyte-quote-btn .mailyte-quote-less { display: none !important; }
  .mailyte-quote-switch:checked ~ .mailyte-quote-btn .mailyte-quote-more { display: none !important; }
  .mailyte-quote-switch:checked ~ .mailyte-quote-btn .mailyte-quote-less { display: inline !important; }
  * { overflow-wrap: anywhere !important; word-break: break-word !important; }
  img, table { max-width: 100% !important; height: auto !important; }
  img[data-blocked] { min-width: 12px; min-height: 12px; border: 1px dashed #d1d5db; border-radius: 2px; }
</style>`;
}

/** Smaller than this is too small to read; the message scrolls sideways instead. */
const MIN_FIT_SCALE = 0.45;
/** A widening smaller than this keeps the current scale: it still fits, and a pane dragged a few pixels need not reflow the message. */
const FIT_STEP = 0.01;
const FIT_TAG = 'mailyte-fit';
const QUOTE_TAG = 'mailyte-quote';
const QUOTE_SWITCH_ID = 'mailyte-quote-switch';

type WebmailBodyFrameProps = {
  html: string;
  /**
   * Did the sender supply an HTML part? (`WebmailMessage.bodyIsHtml`.)
   *
   * Decides whether this frame is the sender's canvas or ours. True: render
   * on white, unaltered, in both themes. False: the body is our own
   * `textToSafeHtml` wrapper, so dark mode may recolour it safely.
   *
   * Defaults to true, which is the conservative direction -- treating HTML as
   * plain text would recolour a sender's background out from under their
   * text and could make a message unreadable; the reverse merely shows a
   * white card where a dark one would have been prettier.
   */
  isHtml?: boolean;
  className?: string;
  /** The message's attachments, so cid: inline images resolve. */
  attachments?: WebmailAttachment[];
  attachmentHref?: (index: number) => string;
  /** Whether the reader has chosen to load this message's remote images. */
  allowRemoteImages?: boolean;
  /** Called with how many remote references were blocked, so the caller can offer to unblock. */
  onBlockedCount?: (count: number) => void;
};

export default function WebmailBodyFrame({
  html,
  isHtml = true,
  className,
  attachments,
  attachmentHref,
  allowRemoteImages = false,
  onBlockedCount,
}: WebmailBodyFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(150);
  const fitRef = useRef({ scale: 1, pan: false });

  /** Scale a message wider than the frame down to fit it. See "Wide mail" above. */
  const fit = useCallback(() => {
    const wrap = iframeRef.current?.contentDocument?.querySelector<HTMLElement>(FIT_TAG);
    if (!wrap) return;
    // Measure at natural size: the last pass must not feed this one.
    wrap.style.removeProperty('zoom');
    wrap.style.removeProperty('overflow-x');
    const available = wrap.clientWidth;
    const natural = wrap.scrollWidth;
    let scale = 1;
    let pan = false;
    if (available > 0 && natural > available + 1) {
      const exact = available / natural;
      if (typeof CSS !== 'undefined' && CSS.supports('zoom', '0.5')) {
        // Floored, so rounding never leaves it a pixel too wide.
        scale = Math.max(MIN_FIT_SCALE, Math.floor(exact * 1000) / 1000);
        pan = exact < MIN_FIT_SCALE;
      } else {
        pan = true;
      }
    }
    const previous = fitRef.current;
    if (scale > previous.scale && scale - previous.scale < FIT_STEP) scale = previous.scale;
    if (scale < 1) wrap.style.setProperty('zoom', String(scale));
    if (pan) wrap.style.setProperty('overflow-x', 'auto');
    fitRef.current = { scale, pan };
  }, []);

  /**
   * Size the frame to the message.
   *
   * Measure the BODY, not documentElement. documentElement.scrollHeight is
   * never less than the frame's own viewport, so measuring it while sizing the
   * frame to the result is a feedback loop: set the height, the viewport grows,
   * scrollHeight reports that larger viewport back, and the next measurement
   * adds another 24px. It compounds once per animation frame, so every message
   * grew without limit and the page scrolled forever. The body's height is
   * content-driven and does not follow the viewport (the reset above keeps it
   * that way), so the same +24 is a one-off rather than a per-frame increment.
   */
  const measure = useCallback(() => {
    const body = iframeRef.current?.contentDocument?.body;
    if (!body) return;
    const next = body.scrollHeight + 24;
    // Sub-pixel jitter must not ping-pong between two values forever.
    setHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
  }, []);

  /**
   * Fit, measure and start watching the message. False while its document is
   * not there yet, so the caller can come back next frame.
   */
  const attach = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    // The wrapper is ours: finding it means this is the message's document and
    // not the empty one the frame holds until srcDoc has been parsed.
    if (!doc?.body || !doc.querySelector(FIT_TAG)) return false;
    // A new document (Show images, a theme change): nothing is scaled yet.
    fitRef.current = { scale: 1, pan: false };
    fit();
    measure();
    // scrollHeight does not account for images still downloading -- routine in
    // HTML mail, and it left long messages visibly cut off. ResizeObserver
    // re-measures on real size changes.
    //
    // It re-fits on them too, because the content itself can change size after
    // the first pass: expanding the quoted thread reveals markup nothing has
    // measured yet, and if that half is wider than the frame, fitting only at
    // open would clip it -- the very thing fit() exists to prevent. This
    // settles rather than oscillates: fit() strips the previous zoom before
    // measuring, so an unchanged message produces an unchanged scale, and an
    // unchanged scale is not a resize.
    resizeObserverRef.current?.disconnect();
    const observer = new ResizeObserver(() => {
      fit();
      measure();
    });
    observer.observe(doc.body);
    resizeObserverRef.current = observer;
    return true;
  }, [fit, measure]);

  // The frame's width changes -- a phone rotated, a pane dragged, the window
  // resized: fit again. Not while a pane edge is being dragged (every frame of
  // the drag would reflow the whole message); once when it is let go.
  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return;
    let width = frame.clientWidth;
    const observer = new ResizeObserver(() => {
      if (frame.clientWidth === width) return; // our own height changes land here too
      width = frame.clientWidth;
      if (!document.documentElement.hasAttribute(DRAGGING_ATTR)) fit();
    });
    observer.observe(frame);
    window.addEventListener(PANE_RESIZE_END_EVENT, fit);
    return () => {
      observer.disconnect();
      window.removeEventListener(PANE_RESIZE_END_EVENT, fit);
    };
  }, [fit]);

  // Seeded from the <html> class rather than from useTheme(), because
  // next-themes resolves to undefined until after mount and its blocking
  // script has already set that class before hydration. Reading it is
  // therefore correct on the very first paint -- waiting for the hook would
  // flash a white sheet behind a plain-text message in dark mode, which is
  // exactly the thing this change exists to remove.
  const { resolvedTheme } = useTheme();
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    if (resolvedTheme) setIsDark(resolvedTheme === 'dark');
  }, [resolvedTheme]);

  const darkPlainText = !isHtml && isDark;

  const sanitized = useMemo(
    () => sanitizeEmailHtml(html, { attachments, attachmentHref, allowRemoteImages }),
    [html, attachments, attachmentHref, allowRemoteImages],
  );

  useEffect(() => {
    onBlockedCount?.(sanitized.blockedCount);
  }, [sanitized.blockedCount, onBlockedCount]);

  // Split off the quoted thread, if there is one worth hiding. The switch has
  // to precede the quote for the sibling selector in the reset to reach it, and
  // all three are children of the fit wrapper so the combinator holds.
  const body = useMemo(() => {
    const { visible, quoted } = splitQuotedHistory(sanitized.html);
    if (!quoted) return sanitized.html;
    return (
      // The checkbox carries the accessible name, because the checkbox is the
      // control; the label is the thing you see and click. Both wordings are
      // always in the markup -- the stylesheet shows whichever one applies.
      `${visible}<input type="checkbox" class="mailyte-quote-switch" id="${QUOTE_SWITCH_ID}"` +
      ` aria-label="Show earlier messages in this conversation">` +
      `<label class="mailyte-quote-btn" for="${QUOTE_SWITCH_ID}">` +
      `<span class="mailyte-quote-more">Show earlier messages</span>` +
      `<span class="mailyte-quote-less">Hide earlier messages</span></label>` +
      `<${QUOTE_TAG}>${quoted}</${QUOTE_TAG}>`
    );
  }, [sanitized.html]);

  // The sender's head styles are inside the wrapper; they still apply.
  // DOMPurify returns balanced markup, so nothing in the message can close the
  // wrapper early.
  const srcDoc = useMemo(
    () => `${emailSafeReset(darkPlainText)}<${FIT_TAG}>${body}</${FIT_TAG}>`,
    [darkPlainText, body],
  );

  /*
   * Measure as soon as the body exists, rather than waiting for `load`.
   *
   * A frame's load event waits for every image in the message. Sizing only
   * there meant the frame sat at its opening height for as long as the
   * pictures took -- a small box with a scrollbar over a mostly empty card,
   * then a jump to full size -- and because the reading pane mounts a fresh
   * frame per message, every open started over at that height. The document is
   * parsed and its body measurable well before its images land, so take the
   * first measurement then. onLoad still fires and re-fits, which is what
   * accounts for the images once they have their real dimensions.
   */
  useEffect(() => {
    if (attach()) return;
    let raf = 0;
    let frames = 0;
    const poll = () => {
      // ~2s at 60fps. Giving up is safe: onLoad is the backstop.
      if (attach() || ++frames > 120) return;
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [srcDoc, attach]);

  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  return (
    <iframe
      ref={iframeRef}
      title="Message content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      // No referrer leaves this frame, for anything that does load.
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      // Everything is already measured and watched by then; this re-fits with
      // the images at their real dimensions.
      onLoad={() => void attach()}
      // No filter. A brightness() pass used to dim the whole frame in dark
      // mode; it took the sender's brand colours and photographs down with
      // the background and made designed templates look broken. See
      // emailSafeReset.
      style={{ height }}
      // The border earns its keep only for a dark plain-text frame, which
      // would otherwise have no edge against an equally dark page. A white
      // HTML card already separates itself.
      className={`w-full rounded border ${
        darkPlainText ? 'border-white/15 bg-[hsl(240_10%_4%)]' : 'border-transparent bg-white'
      } ${className ?? ''}`}
    />
  );
}

/**
 * The bar offering to load a message's blocked images.
 *
 * Two choices on purpose: once for this message, or always for this sender.
 * "Always" is the one people actually want for newsletters they trust, and
 * without it the block becomes something to click past every single time --
 * which is how privacy features get turned off.
 */
export function BlockedImagesBar({
  count,
  senderEmail,
  onShowOnce,
  onAlwaysAllow,
}: {
  count: number;
  senderEmail: string;
  onShowOnce: () => void;
  onAlwaysAllow: () => void;
}) {
  if (count === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted px-3 py-2 text-[12.5px]">
      <ImageOff size={14} className="flex-shrink-0 text-muted-foreground" />
      <span className="text-foreground">
        {count} remote image{count === 1 ? '' : 's'} blocked to keep this message from reporting that you opened it.
      </span>
      <button type="button" onClick={onShowOnce} className="font-semibold text-primary hover:underline">
        Show images
      </button>
      {senderEmail && (
        <button type="button" onClick={onAlwaysAllow} className="font-semibold text-primary hover:underline">
          Always show from {senderEmail}
        </button>
      )}
    </div>
  );
}
