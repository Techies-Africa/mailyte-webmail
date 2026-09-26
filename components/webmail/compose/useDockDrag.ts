'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { DRAGGING_ATTR, type DraggingCursor } from '@/lib/webmail/paneLayout';

/** A press that moves less than this is a click. */
const DRAG_THRESHOLD = 4;
/** How long a dropped window takes to settle into its slot. */
const SETTLE_MS = 160;
/** The neighbours' glide: matches `duration-200` on the window and tab classes. */
const SLIDE_MS = 200;
/** A double-click this soon after a drop is the drop's own clicks, not a request for full screen. */
const DOUBLE_CLICK_GRACE_MS = 500;
/** Pressing a control is using it, never grabbing the window it sits in. */
const NOT_A_HANDLE = 'button, a, input, select, textarea';
const GRABBING: DraggingCursor = 'grabbing';

/** What the dock hears from a drag. */
export interface DockDragCallbacks {
  /** The press has moved past the threshold: a drag, not a click. */
  onStart: () => void;
  /** Where the dragged element's right edge is now, px from the right edge of the screen; the dock reorders live from it. */
  onMove: (right: number) => void;
  /** Dropped -- or `cancelled` by Escape or by the browser (pointercancel), and so to be put back. */
  onEnd: (cancelled: boolean) => void;
}

interface Press {
  pointerId: number;
  startX: number;
  /** The slot's `right` when the press began. */
  startRight: number;
  /** How far the pointer has moved since the press, px (+ is rightwards). */
  dx: number;
  dragging: boolean;
  /** The element that took the press, and later the pointer capture. */
  handle: HTMLElement;
}

/**
 * Keep the dragged element under the pointer. Its visual left is
 * `viewport - right - width + translateX`; holding that at `start + dx` while
 * a live reorder moves its slot means translateX = dx + (right - startRight).
 */
function place(el: HTMLElement, press: Press, right: number) {
  el.style.transform = `translateX(${press.dx + right - press.startRight}px)`;
}

/**
 * Drag a docked compose window (by its title bar) or a tab (anywhere on it)
 * along the row, reordering live as it passes a neighbour (dockLayout's
 * slotForDrag).
 *
 * Hand-rolled pointer events rather than framer-motion's Reorder. Reorder
 * wants its items in normal flow, and these are `position: fixed` slots
 * placed by `right`; its layout animations put transforms on the items and
 * their wrappers, and a transform turns anything fixed inside it -- the
 * full-screen shape of the same window -- into something confined to a box;
 * and it writes zIndex itself, which is ours (the most recently used on top).
 *
 * Only the dragged element moves with the pointer, by a transform written
 * straight to the DOM -- no React render per pointer move. The neighbours
 * glide to their new slots through their own `right` transition as the dock
 * reorders. Escape or a pointercancel puts the window back where it began,
 * and the click a drop would otherwise fire is swallowed, so dropping a tab
 * does not also restore it.
 *
 * While dragging, <html> carries `data-dragging="grabbing"`: globals.css
 * holds the cursor, stops text selecting and keeps email iframes from
 * swallowing the pointer.
 */
export function useDockDrag({
  enabled,
  rootRef,
  right,
  callbacks,
}: {
  /** False on a phone, in full screen, or with only one window: nothing to reorder. */
  enabled: boolean;
  /** The element that moves: the whole window, or the whole tab. */
  rootRef: RefObject<HTMLElement | null>;
  /** Its slot's `right` now. */
  right: number;
  callbacks: DockDragCallbacks;
}) {
  const pressRef = useRef<Press | null>(null);
  const rightRef = useRef(right);
  const callbacksRef = useRef(callbacks);
  const swallowClickRef = useRef(false);
  const droppedAtRef = useRef(-Infinity);
  const escapeRef = useRef<((event: KeyboardEvent) => void) | null>(null);
  const settleRef = useRef<number | undefined>(undefined);

  // The handlers read the latest callbacks without being re-created per render.
  useLayoutEffect(() => {
    callbacksRef.current = callbacks;
  });

  // A live reorder has moved this slot: re-base before paint, so the element
  // stays under the pointer instead of jumping by a slot for one frame.
  useLayoutEffect(() => {
    rightRef.current = right;
    const press = pressRef.current;
    if (press?.dragging && rootRef.current) place(rootRef.current, press, right);
  }, [right, rootRef]);

  const stopEscape = useCallback(() => {
    if (escapeRef.current) window.removeEventListener('keydown', escapeRef.current, true);
    escapeRef.current = null;
  }, []);

  const finish = useCallback(
    (cancelled: boolean) => {
      const press = pressRef.current;
      pressRef.current = null;
      stopEscape();
      if (!press?.dragging) return;
      document.documentElement.removeAttribute(DRAGGING_ATTR);
      // The release fires a click on the handle; it belongs to the drag.
      swallowClickRef.current = true;
      droppedAtRef.current = performance.now();
      if (press.handle.hasPointerCapture(press.pointerId)) press.handle.releasePointerCapture(press.pointerId);
      const el = rootRef.current;
      if (el) {
        // Glide into the slot. `right` too: a cancelled drag sends the slot
        // itself back to where it began.
        el.style.transition = `transform ${SETTLE_MS}ms ease-out, right ${SLIDE_MS}ms ease-out`;
        el.style.transform = '';
        window.clearTimeout(settleRef.current);
        settleRef.current = window.setTimeout(() => {
          el.style.transition = '';
        }, SLIDE_MS + 60);
      }
      callbacksRef.current.onEnd(cancelled);
    },
    [rootRef, stopEscape],
  );

  // Going full screen, down to one window or down to a phone mid-press ends
  // the drag where it began; the handlers that would hear the release are gone.
  useEffect(() => {
    if (!enabled && pressRef.current) finish(true);
  }, [enabled, finish]);

  // Unmounted mid-drag (sent by a shortcut, closed from elsewhere): leave
  // nothing behind on <html> or on window.
  useEffect(
    () => () => {
      stopEscape();
      window.clearTimeout(settleRef.current);
      if (pressRef.current?.dragging) document.documentElement.removeAttribute(DRAGGING_ATTR);
      pressRef.current = null;
    },
    [stopEscape],
  );

  const handleProps = {
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      // A new press starts clean, so a flag left by a drag that fired no
      // click can never eat a real one.
      swallowClickRef.current = false;
      if (!enabled || event.button !== 0 || !event.isPrimary) return;
      if ((event.target as Element).closest(NOT_A_HANDLE)) return;
      pressRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startRight: rightRef.current,
        dx: 0,
        dragging: false,
        handle: event.currentTarget,
      };
    },
    onPointerMove(event: React.PointerEvent<HTMLElement>) {
      const press = pressRef.current;
      if (!press || event.pointerId !== press.pointerId) return;
      // Released somewhere this element never heard about (before capture).
      if (event.buttons === 0) {
        finish(false);
        return;
      }
      press.dx = event.clientX - press.startX;
      if (!press.dragging) {
        if (Math.abs(press.dx) < DRAG_THRESHOLD) return;
        press.dragging = true;
        // Captured only now, past the threshold: capturing on the press would
        // retarget a plain click away from the tab's restore region.
        event.currentTarget.setPointerCapture(event.pointerId);
        const el = rootRef.current;
        if (el) {
          window.clearTimeout(settleRef.current);
          // Follow the pointer exactly; the class's `right` transition would
          // make it trail by 200ms each time a reorder moves its slot.
          el.style.transition = 'none';
        }
        document.documentElement.setAttribute(DRAGGING_ATTR, GRABBING);
        // Capture phase on window: before Dialog, the drawer and the
        // shortcuts, none of which should also act on this Escape.
        const onKeyDown = (key: KeyboardEvent) => {
          if (key.key !== 'Escape') return;
          key.preventDefault();
          key.stopPropagation();
          finish(true);
        };
        escapeRef.current = onKeyDown;
        window.addEventListener('keydown', onKeyDown, true);
        callbacksRef.current.onStart();
      }
      if (rootRef.current) place(rootRef.current, press, rightRef.current);
      callbacksRef.current.onMove(press.startRight - press.dx);
    },
    onPointerUp(event: React.PointerEvent<HTMLElement>) {
      if (pressRef.current?.pointerId === event.pointerId) finish(false);
    },
    onPointerCancel(event: React.PointerEvent<HTMLElement>) {
      if (pressRef.current?.pointerId === event.pointerId) finish(true);
    },
    onLostPointerCapture(event: React.PointerEvent<HTMLElement>) {
      if (pressRef.current?.dragging && pressRef.current.pointerId === event.pointerId) finish(false);
    },
    // Capture phase, so it runs before the restore region's own onClick.
    // `detail === 0` is a click from the keyboard, never the end of a drag.
    onClickCapture(event: React.MouseEvent<HTMLElement>) {
      if (!swallowClickRef.current || event.detail === 0) return;
      swallowClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  /** True just after a drop: the title bar's double-click must not read the drop's clicks as "full screen". */
  const justDropped = () => performance.now() - droppedAtRef.current < DOUBLE_CLICK_GRACE_MS;

  return { handleProps, justDropped };
}
