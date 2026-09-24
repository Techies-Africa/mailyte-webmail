'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DRAGGING_ATTR,
  KEY_STEP,
  KEY_STEP_LARGE,
  PANES,
  PANE_RESIZE_END_EVENT,
  applyPaneWidth,
  between,
  paneWidthsNow,
  storePaneWidth,
  type PaneId,
} from '@/lib/webmail/paneLayout';

type PaneResizeHandleProps = {
  pane: PaneId;
  /** The id of the pane it sizes, for aria-controls. */
  controls: string;
  label: string;
  /** Placement only; the handle is absolutely positioned against its parent. */
  className?: string;
};

type Drag = {
  pointerId: number;
  startX: number;
  latestX: number;
  startWidth: number;
  max: number;
  /** The variable's value before the drag, to put back if the system takes the pointer. */
  previous: string;
  frame: number;
  moved: boolean;
};

/**
 * The draggable edge of the rail or the message list, at md and up.
 *
 * - No React state per pointer move. The width is a CSS variable on <html>
 *   (see lib/webmail/paneLayout.ts); a drag writes it at most once per
 *   animation frame and saves it once, on release. Re-rendering the mailbox
 *   -- fifty message rows -- on every pixel would make the edge lag.
 * - Widths are computed, not measured: a rail halfway through its collapse
 *   transition would report a half-width to a drag that starts on it.
 * - While dragging, `data-dragging` on <html> keeps the cursor, stops text
 *   selecting, and takes the email iframes out of pointer hit-testing -- an
 *   iframe swallows pointer events even under capture in some browsers, and a
 *   release over it would otherwise never be heard.
 * - Double-click puts the shipped width back. The keyboard steps it (arrows,
 *   Shift for larger steps, Home and End for the limits).
 *
 * Not rendered on a collapsed rail, and there is no drag-to-collapse: the
 * rail has its own labelled Collapse control, and a snap would leave the
 * pointer over nothing mid-gesture and throw away a width dragged a few
 * pixels too far.
 */
export default function PaneResizeHandle({ pane, controls, label, className = '' }: PaneResizeHandleProps) {
  const spec = PANES[pane];
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // For assistive technology only -- the width itself lives in CSS. Starts at
  // the default so the server's HTML matches the first client render.
  const [aria, setAria] = useState({ now: spec.fallback, max: spec.max });

  const current = () => {
    const widths = paneWidthsNow();
    return { now: Math.round(widths[pane]), max: Math.round(pane === 'rail' ? widths.railMax : widths.listMax) };
  };

  useEffect(() => {
    // Reading the page's layout is a side effect, which is what an effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAria(current());
    return () => {
      // Cut short by an unmount (the window narrowed past md mid-drag): never
      // leave the whole page un-selectable.
      if (drag.current?.frame) cancelAnimationFrame(drag.current.frame);
      if (drag.current) document.documentElement.removeAttribute(DRAGGING_ATTR);
      drag.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const show = (width: number) => {
    applyPaneWidth(pane, width);
    ref.current?.setAttribute('aria-valuenow', String(Math.round(width)));
  };

  const settle = (width: number, max: number) => {
    show(width);
    storePaneWidth(pane, width);
    setAria({ now: Math.round(width), max });
    // The message frame re-fits a wide email once, now, rather than every frame.
    window.dispatchEvent(new Event(PANE_RESIZE_END_EVENT));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    const { now, max } = current();
    const root = document.documentElement;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      latestX: event.clientX,
      startWidth: now,
      max,
      previous: root.style.getPropertyValue(spec.cssVar),
      frame: 0,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.setAttribute('data-active', '');
    root.setAttribute(DRAGGING_ATTR, 'col-resize');
    // No preventDefault: the press must still reach Menu's click-away
    // listener. Selection is off through the attribute instead.
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || event.pointerId !== d.pointerId) return;
    d.latestX = event.clientX;
    if (Math.abs(d.latestX - d.startX) >= 1) d.moved = true;
    if (d.frame) return;
    // One write per frame: a variable on <html> is a style recalculation and
    // layout of every pane, and nothing between two frames is ever seen.
    d.frame = requestAnimationFrame(() => {
      d.frame = 0;
      show(between(spec.min, d.startWidth + d.latestX - d.startX, d.max));
    });
  };

  const end = (event: React.PointerEvent<HTMLDivElement>, keep: boolean) => {
    const d = drag.current;
    if (!d || event.pointerId !== d.pointerId) return;
    drag.current = null;
    if (d.frame) cancelAnimationFrame(d.frame);
    // lostpointercapture may carry no useful coordinates; pointerup does.
    if (event.type === 'pointerup') d.latestX = event.clientX;
    event.currentTarget.removeAttribute('data-active');
    const root = document.documentElement;
    root.removeAttribute(DRAGGING_ATTR);
    if (!d.moved) return; // a click, or half of a double-click: write nothing
    if (!keep) {
      // The system took the pointer (a gesture, a dialog): put the edge back.
      if (d.previous) root.style.setProperty(spec.cssVar, d.previous);
      else root.style.removeProperty(spec.cssVar);
      setAria(current());
      return;
    }
    settle(between(spec.min, d.startWidth + d.latestX - d.startX, d.max), d.max);
  };

  const reset = () => {
    // Back to nothing stored, so a later change of default reaches this
    // browser too. The rail eases back through its own width transition.
    applyPaneWidth(pane, null);
    storePaneWidth(pane, spec.fallback);
    setAria(current());
    window.dispatchEvent(new Event(PANE_RESIZE_END_EVENT));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { now, max } = current();
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = now - step;
        break;
      case 'ArrowRight':
        next = now + step;
        break;
      case 'Home':
        next = spec.min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return; // Enter, letters and the rest stay with the shortcuts
    }
    event.preventDefault();
    settle(between(spec.min, next, max), max);
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={aria.now}
      aria-valuemin={spec.min}
      aria-valuemax={aria.max}
      aria-valuetext={`${aria.now} pixels`}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => end(event, true)}
      onPointerCancel={(event) => end(event, false)}
      onLostPointerCapture={(event) => end(event, true)}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
      onFocus={() => setAria(current())}
      className={[
        // From 1px inside the pane's edge to 7px into its neighbour: clear of
        // the pane's own scrollbar, over the neighbour's padding. z-20 clears
        // the settings page's sticky header.
        'group absolute inset-y-0 z-20 -ml-px w-2 cursor-col-resize touch-none select-none',
        className,
      ].join(' ')}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-transparent transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary group-data-[active]:bg-primary"
      />
    </div>
  );
}
