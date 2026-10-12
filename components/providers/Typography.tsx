'use client';

import { useEffect } from 'react';
import { applyStoredTypography } from '@/lib/webmail/typography';

/**
 * Re-applies the viewer's text size and font on every full page load.
 *
 * The <head> script in app/layout.tsx is what stops a flash; this is the
 * backstop for a React root rebuild wiping <html>, the same reason
 * PaneLayout.tsx exists. With nothing stored it applies the defaults, which
 * removes the attribute and the property -- so a viewer who has never opened
 * Appearance costs two no-ops.
 *
 * Set from Settings → Appearance.
 */
export default function Typography() {
  useEffect(() => {
    applyStoredTypography();
  }, []);

  return null;
}
