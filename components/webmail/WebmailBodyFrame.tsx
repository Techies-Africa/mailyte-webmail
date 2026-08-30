import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { sanitizeEmailHtml } from '@/lib/webmail/sanitize';
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
 * Message bodies always render light, whatever theme the app is in.
 *
 * This used to follow the app theme and set `color: #e5e7eb` on the body in
 * dark mode. HTML mail is authored against a light background and paints its
 * own -- a white card, a table with a white cell -- but usually leaves the
 * text colour to be inherited. So the email supplied white, we supplied
 * near-white text, and the message came out almost invisible: the only
 * legible parts were the few words the sender had coloured explicitly.
 *
 * Nothing here can know which of the sender's colours were meant to sit on a
 * light background and which would survive inversion, so the safe answer is
 * not to try. Every major mail client renders HTML mail on white in dark mode
 * for the same reason. `color-scheme: light` stops the browser dark-styling
 * form controls and scrollbars inside the frame too.
 */
function emailSafeReset() {
  return `<style>
  :root { color-scheme: light; }
  html, body { max-width: 100%; overflow-x: hidden; background: #ffffff; color: #111827; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  * { overflow-wrap: anywhere !important; word-break: break-word !important; }
  img, table { max-width: 100% !important; height: auto !important; }
  img[data-blocked] { min-width: 12px; min-height: 12px; border: 1px dashed #d1d5db; border-radius: 2px; }
</style>`;
}

type WebmailBodyFrameProps = {
  html: string;
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
  className,
  attachments,
  attachmentHref,
  allowRemoteImages = false,
  onBlockedCount,
}: WebmailBodyFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(150);

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
      srcDoc={emailSafeReset() + sanitized.html}
      onLoad={() => {
        const doc = iframeRef.current?.contentWindow?.document;
        if (!doc?.documentElement) return;

        const measure = () => setHeight(doc.documentElement.scrollHeight + 24);
        measure();

        // scrollHeight at `load` doesn't account for images still
        // downloading -- routine in HTML mail, and it left long messages
        // visibly cut off. ResizeObserver re-measures on real size changes.
        resizeObserverRef.current?.disconnect();
        const observer = new ResizeObserver(measure);
        observer.observe(doc.documentElement);
        resizeObserverRef.current = observer;
      }}
      style={{ height }}
      className={`w-full border-0 bg-white rounded ${className ?? ''}`}
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
    <div className="mb-3 px-3 py-2 rounded-md bg-gray-100 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <ImageOff size={15} className="text-gray-500 flex-shrink-0" />
      <span className="text-gray-700 dark:text-gray-300">
        {count} remote image{count === 1 ? '' : 's'} blocked to keep this message from reporting
        that you opened it.
      </span>
      <button onClick={onShowOnce} className="text-primary hover:underline underline-offset-2">
        Show images
      </button>
      {senderEmail && (
        <button
          onClick={onAlwaysAllow}
          className="text-primary hover:underline underline-offset-2"
        >
          Always show from {senderEmail}
        </button>
      )}
    </div>
  );
}
