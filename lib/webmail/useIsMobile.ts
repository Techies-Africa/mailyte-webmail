'use client';

import { useSyncExternalStore } from 'react';

/**
 * Phone-sized: the exact complement of Tailwind's `md:`, written the way
 * `max-md:` writes it, so this and the CSS never disagree -- not even at
 * 767.5px under browser zoom, where `(max-width: 767px)` and
 * `(min-width: 768px)` would both be false.
 */
export const MOBILE_QUERY = 'not all and (min-width: 768px)';

let media: MediaQueryList | null = null;
const query = () => (media ??= window.matchMedia(MOBILE_QUERY));

function subscribe(onChange: () => void) {
  const list = query();
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

const getSnapshot = () => query().matches;
/** The server draws the desktop layout; the mailbox never renders panes before its session check, so hydration never shows it on a phone. */
const getServerSnapshot = () => false;

/**
 * Whether this is a phone-sized screen, right on the first render of anything
 * mounted after hydration. The resize listener this replaces started at
 * `false` on every mount, so the desktop layout drew for one frame -- and a
 * `?id=` deep link on a phone showed the list and the message side by side
 * until the effect ran.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
