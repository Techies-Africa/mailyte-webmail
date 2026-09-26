'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * How long a reveal keeps the element in view while the page under it
 * settles: the message frame re-measures itself after load and again as
 * images arrive (WebmailBodyFrame), and on a phone the keyboard opens a few
 * hundred ms after focus. Long enough for both, short enough that nothing
 * moves long after the click.
 */
const HOLD_MS = 2000;

/** The reader's own input ends the hold -- it must never fight their scrolling. */
const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The nearest ancestor that scrolls vertically -- the reading pane's body. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * Scroll an element into view on request, then hold it there briefly.
 *
 * `block: 'nearest'` does the least: nothing moves when the element is
 * already fully visible; when it is below, its foot is aligned (so the inline
 * reply's Send row shows); when it is taller than the pane -- a phone,
 * landscape, the keyboard up -- its top is aligned, so the caret shows.
 *
 * Reduced motion is checked here because the rule in globals.css shortens
 * CSS animations and transitions but does not reach a script's smooth scroll.
 */
export function useRevealInView<T extends HTMLElement>(): [RefObject<T | null>, () => void] {
  const ref = useRef<T>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const reveal = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    stopRef.current?.();

    // 'auto' is instant here: nothing in globals.css sets scroll-behavior.
    element.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });

    // Follow-ups jump rather than glide: the content is already moving under
    // the reader, and a keyboard fires resize every frame -- a smooth scroll
    // restarted each frame only lags behind it.
    const follow = () => element.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    const cleanups: (() => void)[] = [];
    const stop = () => {
      cleanups.splice(0).forEach((fn) => fn());
      if (stopRef.current === stop) stopRef.current = null;
    };
    stopRef.current = stop;

    // The message frame above growing (images arriving), or the pane itself
    // shrinking (Android with interactive-widget=resizes-content), pushes the
    // element back out.
    const scroller = scrollParent(element);
    const content = scroller?.firstElementChild;
    if (scroller && content instanceof HTMLElement && typeof ResizeObserver !== 'undefined') {
      const size = () => `${scroller.clientHeight}:${content.offsetHeight}`;
      let last = size();
      const observer = new ResizeObserver(() => {
        const next = size();
        if (next === last) return; // the first notification, or no real change
        last = next;
        follow();
      });
      observer.observe(scroller);
      observer.observe(content);
      cleanups.push(() => observer.disconnect());
    }

    // The keyboard laid over the page (iOS, and Android's default).
    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener('resize', follow);
      cleanups.push(() => viewport.removeEventListener('resize', follow));
    }

    // In the next frame, not now: the `r` shortcut calls this while its own
    // keydown is still being dispatched, and a listener added this instant
    // could hear that same key and end the hold before it began.
    const frame = requestAnimationFrame(() => {
      TAKEOVER_EVENTS.forEach((type) => window.addEventListener(type, stop, { capture: true, passive: true }));
    });
    cleanups.push(() => {
      cancelAnimationFrame(frame);
      TAKEOVER_EVENTS.forEach((type) => window.removeEventListener(type, stop, { capture: true }));
    });

    const timer = window.setTimeout(stop, HOLD_MS);
    cleanups.push(() => window.clearTimeout(timer));
  }, []);

  return [ref, reveal];
}
