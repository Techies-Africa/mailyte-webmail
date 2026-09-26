'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Closes a popup on a press outside `ref`, or on Escape.
 *
 * Menu and SelectMenu share this rather than each carrying a copy of the same
 * effect. Escape is marked handled (preventDefault): listeners further out --
 * the phone drawer, the reading pane's reply box, the global shortcuts, all
 * on `window` and so after this one -- see `defaultPrevented` and leave the
 * key alone, so one Escape closes only the innermost thing.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void): void {
  // Read through a ref, so a fresh arrow from the caller does not re-attach
  // the listeners on every render.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const onPress = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismissRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onDismissRef.current();
    };
    document.addEventListener('mousedown', onPress);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPress);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref]);
}
