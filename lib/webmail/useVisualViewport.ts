'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * The part of the screen the on-screen keyboard leaves visible, for a
 * full-screen sheet whose bottom bar must stay above it.
 *
 * iOS slides the visual viewport over the page instead of shrinking it, so a
 * `fixed inset-0` compose window kept its full height and the keyboard sat on
 * top of Send. (Android shrinks the page itself, with the viewport's
 * interactive-widget setting in app/layout.tsx; there these numbers are the
 * page's own, and nothing changes.)
 *
 * Null when disabled, unsupported, or pinch-zoomed: following a zoomed
 * viewport would stop people zooming into the sheet.
 */
export function useVisualViewport(enabled: boolean): { top: number; height: number } | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const viewport = enabled ? window.visualViewport : null;
      if (!viewport) return () => {};
      viewport.addEventListener('resize', onChange);
      viewport.addEventListener('scroll', onChange);
      return () => {
        viewport.removeEventListener('resize', onChange);
        viewport.removeEventListener('scroll', onChange);
      };
    },
    [enabled],
  );
  // A string, so an unchanged viewport is an unchanged snapshot.
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      const viewport = enabled ? window.visualViewport : null;
      return viewport && Math.abs(viewport.scale - 1) < 0.01
        ? `${Math.round(viewport.offsetTop)}:${Math.round(viewport.height)}`
        : '';
    },
    () => '',
  );
  if (!snapshot) return null;
  const [top, height] = snapshot.split(':').map(Number);
  return { top, height };
}
