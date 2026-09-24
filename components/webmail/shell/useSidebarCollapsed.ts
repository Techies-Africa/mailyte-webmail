'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { applyRailCollapsed, readRailCollapsed, storeRailCollapsed } from '@/lib/webmail/paneLayout';
import { useIsMobile } from '@/lib/webmail/useIsMobile';

// One value for every screen, read from storage once. Mail, Calendar,
// Contacts and Settings each render their own Sidebar; a module-level value
// means a client-side move between them renders the rail right the first
// time, instead of open for a frame and then collapsing.
const listeners = new Set<() => void>();
let stored: boolean | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  if (stored === null) stored = readRailCollapsed();
  return stored;
}

/** The server draws the rail open; the <head> script has already set its real width, and globals.css covers the frame before hydration. */
const getServerSnapshot = () => false;

/**
 * Whether the rail shows icons only, and the toggle.
 *
 * The value is what the rail actually shows: phones ignore the stored choice,
 * because there the rail is a drawer that always opens full width. It used to
 * be `collapsed && !menuOpen` at every call site, so a drawer opened from a
 * collapsed desktop choice started at 58px, and its labels vanished halfway
 * through sliding shut.
 *
 * The toggle writes `data-rail` on <html> in the same task as React's
 * re-render, so the CSS width (which reads that attribute) and the icons-only
 * content change together.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isMobile = useIsMobile();

  const toggle = useCallback(() => {
    const next = !getSnapshot();
    stored = next;
    storeRailCollapsed(next);
    applyRailCollapsed(next);
    listeners.forEach((listener) => listener());
  }, []);

  return [collapsed && !isMobile, toggle];
}
