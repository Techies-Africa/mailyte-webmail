/**
 * Where the mobile apps are listed in the stores.
 *
 * Read from NEXT_PUBLIC_APP_STORE_URL and NEXT_PUBLIC_PLAY_STORE_URL. They are
 * rendered in the browser, so like the brand name (lib/webmail/brand.ts) they
 * are inlined at build time. The published image is brand-neutral, so a build
 * that sets neither link shows nothing at all, and one that sets a single link
 * shows that store only: a half-launched app never ships a dead button.
 *
 * https only; anything else counts as not set.
 */
export interface StoreLink {
  id: 'app-store' | 'play-store';
  /** Apple's and Google's own wording, used as the link's name. */
  label: string;
  href: string;
  /** A square store glyph in /public. */
  logo: string;
}

function https(value: string | undefined): string {
  const url = (value ?? '').trim();
  return /^https:\/\//i.test(url) ? url : '';
}

/**
 * The store that belongs to the phone or tablet this browser is on, or null
 * when it is not one or cannot be told (a desktop, an unusual browser): the
 * caller then shows every store rather than guess. Browser only.
 */
export function ownStore(): StoreLink['id'] | null {
  const ua = navigator.userAgent;
  // Chromium's client hints survive "Request desktop site", which rewrites the user agent.
  const hinted = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform;
  if (hinted === 'Android' || /Android/i.test(ua)) return 'play-store';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'app-store';
  // An iPad asks for the desktop site by default: it says "Macintosh", but a Mac has no touch screen.
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'app-store';
  return null;
}

/** The stores that have a link configured, App Store first. */
export function storeLinks(): StoreLink[] {
  const stores: StoreLink[] = [];
  // Each variable is read by its full name: Next only inlines a literal
  // `process.env.NEXT_PUBLIC_X`, never a lookup by a computed key.
  const apple = https(process.env.NEXT_PUBLIC_APP_STORE_URL);
  const google = https(process.env.NEXT_PUBLIC_PLAY_STORE_URL);
  if (apple) stores.push({ id: 'app-store', label: 'Download on the App Store', href: apple, logo: '/app-store-logo.png' });
  if (google) stores.push({ id: 'play-store', label: 'Get it on Google Play', href: google, logo: '/play-store-logo.png' });
  return stores;
}
