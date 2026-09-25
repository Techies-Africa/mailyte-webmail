'use client';

import { useLayoutEffect, type RefObject } from 'react';

/** How close to the screen's edge a popup may come. */
const EDGE = 8;

/**
 * Nudges an open popup sideways until it is inside the screen.
 *
 * Menus and the emoji palette are anchored to one side of their button,
 * which is right on a desktop and wrong on a 360px phone, where a 210-270px
 * panel from a button near the edge ran off it. Measured before paint, so it
 * never shows in the wrong place first. Through the CSS `translate` property
 * rather than `transform`, which the entrance animation owns.
 */
export function useKeepOnScreen(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    element.style.removeProperty('translate');
    const { left, right } = element.getBoundingClientRect();
    const overRight = right - (window.innerWidth - EDGE);
    const overLeft = EDGE - left;
    if (overRight > 0) element.style.setProperty('translate', `${-Math.min(overRight, left - EDGE)}px 0`);
    else if (overLeft > 0) element.style.setProperty('translate', `${overLeft}px 0`);
  }, [ref, open]);
}
