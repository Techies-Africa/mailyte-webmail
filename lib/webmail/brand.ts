/**
 * What this deployment calls itself.
 *
 * Read from NEXT_PUBLIC_* because it is rendered in the browser, which means
 * it IS baked in at build time -- unlike the API base URL, which is read
 * server-side per request precisely so it can be set at run time (see
 * lib/webmail/server.ts). Branding is a build-time choice: anyone rebranding
 * this is already building their own image.
 *
 * The mark itself is artwork in public/ (see components/brand/BrandMark). When
 * the name is "Mailyte" the real lockup is drawn; any other name gets the
 * mark beside that name as text, so a rebrand is one variable and two PNGs.
 * NEXT_PUBLIC_BRAND_MARK is still accepted for older build scripts but no
 * longer rendered.
 */
export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || 'Webmail',
} as const;
