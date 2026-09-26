'use client';

import { useLayoutEffect } from 'react';
import { applyStoredPaneLayout } from '@/lib/webmail/paneLayout';

/**
 * Puts the remembered pane widths and the collapsed rail back on <html>.
 *
 * The <head> script in app/layout.tsx does this before the first paint, which
 * is all a production load needs. But when React rebuilds <html> -- the dev
 * Strict Mode remount, or recovering from a hydration error by rendering the
 * root on the client -- it keeps only the attributes it manages from JSX, and
 * the script does not run again. The panes would jump back to their defaults
 * until the next reload. Before paint, so nothing is seen; a no-op otherwise.
 */
export default function PaneLayout() {
  useLayoutEffect(() => {
    applyStoredPaneLayout();
  }, []);
  return null;
}
