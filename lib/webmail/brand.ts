/**
 * What this deployment calls itself.
 *
 * Read from NEXT_PUBLIC_* because it is rendered in the browser, which means
 * it IS baked in at build time -- unlike the API base URL, which is read
 * server-side per request precisely so it can be set at run time (see
 * lib/webmail/server.ts). Branding is a build-time choice: anyone rebranding
 * this is already building their own image.
 *
 * Deliberately text, not an image file. A logo would be one more asset to
 * ship, one more thing to replace, and one more 404 for anyone who forgot to.
 */
export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || 'Webmail',
  /** One or two characters for the square mark beside the name. */
  mark: process.env.NEXT_PUBLIC_BRAND_MARK || '✉',
} as const;
