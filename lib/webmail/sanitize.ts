// Sanitising and de-tracking HTML mail before it is rendered.
//
// PRD 01-PRD-webmail.md SS7 items 1 and 2, both binding:
//
//  1. DOMPurify runs *in addition to* WebmailBodyFrame's sandboxed iframe.
//     The iframe is well-built and stays -- withholding `allow-scripts`
//     means no script in it ever runs -- but it was the only layer, so a
//     single mistake in one sandbox attribute was the whole defence. These
//     are independent: the sandbox stops script from executing, the
//     sanitiser stops it from being in the document at all.
//
//  2. Remote images are blocked by default. Every <img> pointing at another
//     server is a read receipt the sender gets whether or not the reader
//     wanted to send one, and mail bodies carry them in more places than
//     <img src>: CSS background-image, <style> blocks, the legacy
//     `background` attribute. All of them are neutralised together, because
//     blocking only <img> is a privacy feature that does not work.
//
// Inline images (cid: references to the message's own attachments) are NOT
// remote and are never blocked -- they are already downloaded, and treating
// them as tracking would break every signature logo in existence.

import DOMPurify from 'dompurify';
import type { WebmailAttachment } from '@/components/webmail/types';

/** A 1x1 transparent GIF. Keeps layout from collapsing where an image was. */
const PLACEHOLDER_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const REMOTE_URL = /^(https?:)?\/\//i;
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

export interface SanitizeOptions {
  /** The message's own attachments, so cid: references can be resolved. */
  attachments?: WebmailAttachment[];
  /** Where an inline attachment's bytes live. */
  attachmentHref?: (index: number) => string;
  /** True once the reader has chosen to show images for this message/sender. */
  allowRemoteImages?: boolean;
}

export interface SanitizeResult {
  html: string;
  /** How many remote references were neutralised. 0 means nothing to offer. */
  blockedCount: number;
}

/**
 * Strip anything executable, then neutralise remote references unless the
 * reader has asked for them.
 */
export function sanitizeEmailHtml(html: string, options: SanitizeOptions = {}): SanitizeResult {
  const { attachments = [], attachmentHref, allowRemoteImages = false } = options;

  if (!html) return { html: '', blockedCount: 0 };

  const clean = DOMPurify.sanitize(html, {
    // Elements that either execute, navigate, or reach the network on their
    // own behalf. <base> is here because it silently re-points every
    // relative URL in the document, and <form> because a message body has
    // no legitimate reason to post anywhere.
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'form', 'link', 'meta', 'svg'],
    // srcset and ping are network fetches that survive rewriting `src`
    // alone; formaction is a submit-time navigation target.
    FORBID_ATTR: ['srcset', 'ping', 'formaction', 'form', 'action'],
    // DOMPurify strips every on* handler and javascript:/data: URI in
    // dangerous positions as part of its default profile.
    ALLOW_DATA_ATTR: false,
    RETURN_DOM: true,
    // Parse the message as a whole document, not a body fragment.
    //
    // WHOLE_DOCUMENT was false, which makes DOMPurify treat the input as body
    // content and throw away <head> -- and <head> is exactly where HTML mail
    // puts its <style> block. Every rule the sender wrote was dropped before
    // it reached the page: headings lost their weight, list markers and
    // padding disappeared, and the message rendered as a wall of unstyled
    // text. The <style> handling further down was already written for this
    // and simply never had anything to find.
    //
    // Safe to keep: DOMPurify sanitises CSS as well as markup, and the loop
    // below rewrites every remote url() inside <style> to the placeholder
    // when images are blocked -- so styles cannot smuggle in a read receipt.
    WHOLE_DOCUMENT: true,
  }) as unknown as HTMLElement;

  let blockedCount = 0;

  const cidMap = new Map<string, number>();
  for (const attachment of attachments) {
    if (attachment.contentId) {
      cidMap.set(attachment.contentId.replace(/^<|>$/g, '').toLowerCase(), attachment.index);
    }
  }

  const resolveCid = (value: string): string | null => {
    const cid = value.slice(4).toLowerCase();
    const index = cidMap.get(cid);
    if (index === undefined || !attachmentHref) return null;
    return attachmentHref(index);
  };

  // --- <img>, including cid: inline images -------------------------------
  for (const img of Array.from(clean.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';

    if (src.toLowerCase().startsWith('cid:')) {
      const resolved = resolveCid(src);
      if (resolved) {
        img.setAttribute('src', resolved);
      } else {
        // An inline reference whose part isn't in this message. Nothing to
        // show and nothing to unblock -- remove it rather than leave a
        // broken-image icon the reader can do nothing about.
        img.remove();
      }
      continue;
    }

    if (REMOTE_URL.test(src) && !allowRemoteImages) {
      // The original URL is deliberately NOT kept anywhere in the output.
      // "Show images" re-runs this function over the untouched original
      // HTML, so stashing the address in a data- attribute would buy
      // nothing and would leave the tracking URL sitting in the rendered
      // document -- which is the thing being blocked.
      img.setAttribute('src', PLACEHOLDER_PIXEL);
      img.setAttribute('data-blocked', 'true');
      blockedCount += 1;
    }
  }

  // --- the legacy `background` attribute ---------------------------------
  for (const el of Array.from(clean.querySelectorAll('[background]'))) {
    const value = el.getAttribute('background') ?? '';
    if (REMOTE_URL.test(value) && !allowRemoteImages) {
      el.removeAttribute('background');
      blockedCount += 1;
    }
  }

  // --- url() inside inline style attributes ------------------------------
  if (!allowRemoteImages) {
    for (const el of Array.from(clean.querySelectorAll('[style]'))) {
      const style = el.getAttribute('style') ?? '';
      const stripped = stripRemoteCssUrls(style);
      if (stripped.changed) {
        el.setAttribute('style', stripped.css);
        blockedCount += stripped.count;
      }
    }

    // --- url() inside <style> blocks -------------------------------------
    for (const styleTag of Array.from(clean.querySelectorAll('style'))) {
      const stripped = stripRemoteCssUrls(styleTag.textContent ?? '');
      if (stripped.changed) {
        styleTag.textContent = stripped.css;
        blockedCount += stripped.count;
      }
    }
  }

  // --- links -------------------------------------------------------------
  // Every link in a message body opens in a new tab, with the referrer and
  // the opener withheld: a message is not allowed to navigate the reader's
  // mail client away from itself, or to learn where it was read from.
  for (const anchor of Array.from(clean.querySelectorAll('a[href]'))) {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer nofollow');
  }

  // Serialise as a fragment, not a document.
  //
  // With WHOLE_DOCUMENT the sanitised result is an <html> element, so
  // clean.innerHTML would be "<head>…</head><body>…</body>". That gets
  // concatenated after the reset stylesheet in WebmailBodyFrame, giving the
  // iframe a stylesheet followed by a head and a body -- invalid nesting that
  // browsers then silently rearrange. Lift the head's <style> blocks out and
  // emit them ahead of the body's own markup instead: same CSS, same order,
  // and the output stays a fragment exactly as callers expect.
  const head = clean.querySelector('head');
  const body = clean.querySelector('body');
  const headStyles = head
    ? Array.from(head.querySelectorAll('style'))
        .map((el) => el.outerHTML)
        .join('')
    : '';

  return { html: headStyles + (body ? body.innerHTML : clean.innerHTML), blockedCount };
}

function stripRemoteCssUrls(css: string): { css: string; count: number; changed: boolean } {
  let count = 0;
  const next = css.replace(CSS_URL, (match, _quote, url: string) => {
    if (!REMOTE_URL.test(url)) return match;
    count += 1;
    return `url("${PLACEHOLDER_PIXEL}")`;
  });

  return { css: next, count, changed: count > 0 };
}

// ---------------------------------------------------------------------------
// Per-sender "always show images" allowance
// ---------------------------------------------------------------------------

const ALLOWLIST_KEY = 'mailyte_webmail_image_senders';

/**
 * Senders whose images load without asking.
 *
 * Deliberately local to the browser rather than stored server-side: it is a
 * reading preference, not mailbox state, and keeping it here means the
 * choice never becomes another thing to sync or leak. Failing closed on a
 * storage error is the correct direction -- images stay blocked.
 */
export function allowedImageSenders(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ALLOWLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function isImageSenderAllowed(email: string): boolean {
  if (!email) return false;
  return allowedImageSenders().includes(email.toLowerCase());
}

export function allowImageSender(email: string): void {
  if (typeof window === 'undefined' || !email) return;
  const next = Array.from(new Set([...allowedImageSenders(), email.toLowerCase()]));
  try {
    window.localStorage.setItem(ALLOWLIST_KEY, JSON.stringify(next));
  } catch {
    // Private browsing with storage denied. The reader can still use the
    // per-message "Show images" button; only the remembering is lost.
  }
}
