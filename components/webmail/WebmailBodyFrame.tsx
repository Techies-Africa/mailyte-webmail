import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { ImageOff } from 'lucide-react';
import { sanitizeEmailHtml } from '@/lib/webmail/sanitize';
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
 */
function emailSafeReset(darkPlainText: boolean) {
  const surface = darkPlainText
    // The app's own dark tokens, so the frame is continuous with the page
    // behind it rather than a near-miss shade floating on top of it.
    ? { scheme: 'dark', bg: 'hsl(240 10% 4%)', fg: 'hsl(0 0% 98%)', link: '#8b84ff' }
    : { scheme: 'light', bg: 'white', fg: '#111827', link: '#3730a3' };

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

  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  return (
    <iframe
      ref={iframeRef}
      title="Message content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      // No referrer leaves this frame, for anything that does load.
      referrerPolicy="no-referrer"
      // The sender's head styles are inside the wrapper; they still apply.
      // DOMPurify returns balanced markup, so nothing in the message can
      // close the wrapper early.
      srcDoc={`${emailSafeReset(darkPlainText)}<${FIT_TAG}>${sanitized.html}</${FIT_TAG}>`}
      onLoad={() => {
        const doc = iframeRef.current?.contentWindow?.document;
        if (!doc?.documentElement) return;

        // Measure the BODY, not documentElement. documentElement.scrollHeight
        // is never less than the frame's own viewport, so measuring it while
        // sizing the frame to the result is a feedback loop: set the height,
        // the viewport grows, scrollHeight reports that larger viewport back,
        // and the next measurement adds another 24px. It compounds once per
        // animation frame, so every message grew without limit and the page
        // scrolled forever. The body's height is content-driven and does not
        // follow the viewport (the reset above keeps it that way), so the
        // same +24 is now a one-off rather than a per-frame increment.
        const measure = () => {
          const body = doc.body;
          if (!body) return;
          const next = body.scrollHeight + 24;
          // Sub-pixel jitter must not ping-pong between two values forever.
          setHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
        };
        // A new document (Show images, a theme change): nothing is scaled yet.
        fitRef.current = { scale: 1, pan: false };
        fit();
        measure();

        // scrollHeight at `load` doesn't account for images still
        // downloading -- routine in HTML mail, and it left long messages
        // visibly cut off. ResizeObserver re-measures on real size changes.
        resizeObserverRef.current?.disconnect();
        const observer = new ResizeObserver(measure);
        observer.observe(doc.body);
        resizeObserverRef.current = observer;
      }}
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
