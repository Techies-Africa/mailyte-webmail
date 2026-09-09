'use client';

import { useEffect } from 'react';
import { applyAccent, readAccent } from '@/lib/webmail/accent';

/**
 * Re-applies the viewer's accent on every full page load.
 *
 * Client-side navigation keeps the attribute on <html>, so this runs once per
 * document. With nothing stored it applies the shipped default, which removes
 * the attribute — so a viewer who has never opened Appearance costs one no-op.
 *
 * Set from Settings → Appearance.
 */
export default function AccentTheme() {
  useEffect(() => {
    applyAccent(readAccent());
  }, []);

  return null;
}
