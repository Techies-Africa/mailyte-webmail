'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DRAGGING_ATTR } from '@/lib/webmail/paneLayout';
import { useIsMobile } from '@/lib/webmail/useIsMobile';

type FloatingPanelProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Where the panel sits. `anchor` renders it where placed (position: absolute inside a relative parent). */
  placement?: 'top-right' | 'anchor';
  width?: number;
  className?: string;
  label: string;
  /**
   * Lets a top-right panel be dragged, at md and up, by any element inside it
   * marked `data-drag-handle`, and remembers where it was left under this
   * name, per browser. Absent: it stays at the top right.
   */
  positionKey?: string;
};

/**
 * Where a moved panel was left: its distance from the NEARER side of the
 * window, and from the top. By side rather than as a plain left offset, so a
 * panel left near the right edge is still near it after the window is
 * resized, or on a wider screen.
 */
type Spot = { side: 'left' | 'right'; x: number; y: number };
type Point = { left: number; top: number };

type Drag = {
  pointerId: number;
  /** The handle pressed: it holds the pointer capture for the whole gesture. */
  handle: HTMLElement;
  startX: number;
  startY: number;
  /** The panel's top-left and size when the press began. */
  origin: Point;
  width: number;
  height: number;
  /** Where it was before the drag: null for its home at the top right. A cancelled drag goes back there. */
  before: Point | null;
  next: Point;
  dragging: boolean;
  frame: number;
};

/** The clear space kept between a moved panel and the window's edges. */
const EDGE = 8;
/** A press that moves less than this is a click (or half a double-click), not a drag. */
const DRAG_THRESHOLD = 3;
/** Pressing a control inside a handle is using the control, never moving the panel. */
const NOT_A_HANDLE = 'button, a, input, select, textarea, label';
const HANDLE = '[data-drag-handle]';

const storageKey = (name: string) => `mailyte.webmail.panelSpot.${name}`;

function readSpot(name: string): Spot | null {
  try {
    const raw = window.localStorage.getItem(storageKey(name));
    if (!raw) return null;
    const spot = JSON.parse(raw) as Partial<Spot>;
    if ((spot.side === 'left' || spot.side === 'right') && Number.isFinite(spot.x) && Number.isFinite(spot.y)) {
      return { side: spot.side, x: spot.x as number, y: spot.y as number };
    }
    return null;
  } catch {
    // Blocked storage or a mangled value: its home at the top right is a fine answer.
    return null;
  }
}

function storeSpot(name: string, spot: Spot | null): void {
  try {
    if (spot) window.localStorage.setItem(storageKey(name), JSON.stringify(spot));
    else window.localStorage.removeItem(storageKey(name));
  } catch {
    // Not fatal: it stays where it was put for this page load.
  }
}

/** A top-left that keeps a panel this size on screen -- or at least its top-left corner, if it is bigger than the window. */
function clampToWindow(left: number, top: number, width: number, height: number): Point {
  return {
    left: Math.round(Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE))),
    top: Math.round(Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE))),
  };
}

function spotOf(point: Point, width: number): Spot {
  const side = point.left + width / 2 < window.innerWidth / 2 ? 'left' : 'right';
  return {
    side,
    x: Math.round(side === 'left' ? point.left : window.innerWidth - point.left - width),
    y: Math.round(point.top),
  };
}

function pointOf(spot: Spot, width: number, height: number): Point {
  const left = spot.side === 'left' ? spot.x : window.innerWidth - spot.x - width;
  return clampToWindow(left, spot.y, width, height);
}

/** Whether a press landed on a handle, and not on a control inside it. */
function onHandle(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(HANDLE) && !target.closest(NOT_A_HANDLE);
}

/**
 * A floating panel with a click-away backdrop and Escape to close.
 *
 * The redesign's calendar and contacts panels float over the reading pane at
 * the top right; the profile menu floats above its own button. Both need the
 * same two behaviours, so they share this rather than two copies of the same
 * event wiring.
 *
 * On a phone a top-right panel is a sheet rising from the bottom edge over a
 * dimmed page instead: a 300px card pinned to the right of a 360px screen
 * sat on top of the open menu drawer, with its left edge floating in the
 * middle of nothing. The sheet sits above the minimized compose tabs (z-140)
 * and below a full-screen compose window (z-200). The width is a CSS
 * variable rather than an inline width, which would beat the sheet's.
 *
 * With a `positionKey`, a desktop panel can be dragged by its handle (the
 * element marked `data-drag-handle`) and reopens where it was left, in this
 * browser. The position is CSS variables read only by `md:` classes, for the
 * same reason as the width: the phone sheet must win below md. It moves by
 * left/top, not a transform, which the entrance animation owns. While
 * dragging, `data-dragging` on <html> holds the cursor, stops text selecting
 * and keeps email iframes from swallowing the pointer; Escape puts the panel
 * back, and a double-click on the handle sends it home to the top right.
 */
export default function FloatingPanel({
  open,
  onClose,
  children,
  placement = 'top-right',
  width = 300,
  className,
  label,
  positionKey,
}: FloatingPanelProps) {
  const isMobile = useIsMobile();
  const sheet = placement === 'top-right';
  // A phone's panel is a sheet on the bottom edge: nothing to move.
  const movable = sheet && !!positionKey && !isMobile;
  const panelRef = useRef<HTMLDivElement>(null);
  /** Where it has been moved to, px from the window's top-left; null is its home at the top right. */
  const [pos, setPos] = useState<Point | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const escapeRef = useRef<((event: KeyboardEvent) => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); // handled: the message behind stays open
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Opened: where it was left last time, placed before the first paint so it
  // never shows at the top right first. Measured, then clamped: the window may
  // be smaller than when it was left.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!open || !movable || !positionKey || !el) return;
    const spot = readSpot(positionKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- placing before paint is what a layout effect is for
    setPos(spot ? pointOf(spot, el.offsetWidth, el.offsetHeight) : null);
  }, [open, movable, positionKey]);

  // A window resized while a moved panel is open keeps it by its side, on screen.
  useEffect(() => {
    if (!open || !movable || !positionKey || !pos) return;
    const onResize = () => {
      const el = panelRef.current;
      const spot = readSpot(positionKey);
      if (el && spot) setPos(pointOf(spot, el.offsetWidth, el.offsetHeight));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, movable, positionKey, pos]);

  // Mid-drag, React may re-render (the setPos at the start, anything else on
  // the page) after a frame has already moved the panel further: put the
  // latest position back before paint, so it never snaps back a few px.
  useLayoutEffect(() => {
    const d = dragRef.current;
    const el = panelRef.current;
    if (!d?.dragging || !el) return;
    el.style.setProperty('--panel-left', `${d.next.left}px`);
    el.style.setProperty('--panel-top', `${d.next.top}px`);
  });

  // Closed, unmounted, or dropped below md mid-drag (the pointer handlers
  // go, so the release would never be heard): leave nothing on <html> or on
  // window.
  useEffect(() => {
    if (!open || !movable) return;
    return () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.frame) cancelAnimationFrame(d.frame);
      if (d?.dragging) document.documentElement.removeAttribute(DRAGGING_ATTR);
      if (escapeRef.current) window.removeEventListener('keydown', escapeRef.current, true);
      escapeRef.current = null;
    };
  }, [open, movable]);

  const finish = (keep: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (escapeRef.current) window.removeEventListener('keydown', escapeRef.current, true);
    escapeRef.current = null;
    if (!d?.dragging) return; // a click on the handle: nothing moved, nothing to save
    if (d.frame) cancelAnimationFrame(d.frame);
    document.documentElement.removeAttribute(DRAGGING_ATTR);
    if (d.handle.hasPointerCapture(d.pointerId)) d.handle.releasePointerCapture(d.pointerId);
    const el = panelRef.current;
    const final = keep ? d.next : d.before;
    if (final && el) {
      el.style.setProperty('--panel-left', `${final.left}px`);
      el.style.setProperty('--panel-top', `${final.top}px`);
    }
    setPos(final);
    if (keep && positionKey) storeSpot(positionKey, spotOf(d.next, d.width));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current?.dragging || !onHandle(event.target)) return;
    const handle = (event.target as Element).closest<HTMLElement>(HANDLE);
    if (!handle) return;
    // Captured on the handle at once. A fast flick that leaves the panel
    // before the first move still drags; on touch the browser would
    // otherwise capture the touched child and take it away mid-drag; and the
    // clicks of a double-click still land on the handle.
    handle.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = { left: Math.round(rect.left), top: Math.round(rect.top) };
    dragRef.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      width: rect.width,
      height: rect.height,
      before: pos,
      next: origin,
      dragging: false,
      frame: 0,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || event.pointerId !== d.pointerId) return;
    // Released somewhere this element never heard about (before capture).
    if (event.buttons === 0) {
      finish(true);
      return;
    }
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.dragging = true;
      document.documentElement.setAttribute(DRAGGING_ATTR, 'grabbing');
      // Capture phase on window: Escape puts the panel back, and must not also close it.
      const onKey = (key: KeyboardEvent) => {
        if (key.key !== 'Escape') return;
        key.preventDefault();
        key.stopPropagation();
        finish(false);
      };
      escapeRef.current = onKey;
      window.addEventListener('keydown', onKey, true);
      // From its home at the top right to explicit coordinates, at the same place: no jump.
      setPos(d.origin);
    }
    d.next = clampToWindow(d.origin.left + dx, d.origin.top + dy, d.width, d.height);
    if (d.frame) return;
    // Straight to the DOM, once a frame: no React render per pointer move.
    d.frame = requestAnimationFrame(() => {
      d.frame = 0;
      const el = panelRef.current;
      if (!el) return;
      el.style.setProperty('--panel-left', `${d.next.left}px`);
      el.style.setProperty('--panel-top', `${d.next.top}px`);
    });
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!positionKey || !onHandle(event.target)) return;
    storeSpot(positionKey, null);
    setPos(null);
  };

  if (!open) return null;

  const style = {
    '--panel-w': `${width}px`,
    ...(pos ? { '--panel-left': `${pos.left}px`, '--panel-top': `${pos.top}px` } : {}),
  } as React.CSSProperties;

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={sheet ? 'fixed inset-0 z-40 max-md:z-[150] max-md:bg-black/50' : 'fixed inset-0 z-40'}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        style={style}
        onPointerDown={movable ? onPointerDown : undefined}
        onPointerMove={movable ? onPointerMove : undefined}
        onPointerUp={
          movable
            ? (event) => {
                if (dragRef.current?.pointerId === event.pointerId) finish(true);
              }
            : undefined
        }
        onPointerCancel={
          movable
            ? (event) => {
                if (dragRef.current?.pointerId === event.pointerId) finish(false);
              }
            : undefined
        }
        onLostPointerCapture={
          movable
            ? (event) => {
                // Only the handle's own capture: a child's bubbling up is not the end of the drag.
                const d = dragRef.current;
                if (d?.dragging && event.target === d.handle && d.pointerId === event.pointerId) finish(true);
              }
            : undefined
        }
        onDoubleClick={movable ? onDoubleClick : undefined}
        className={[
          'overflow-hidden border border-border bg-popover text-popover-foreground shadow-panel',
          sheet
            ? [
                'fixed z-50',
                'max-md:inset-x-0 max-md:bottom-0 max-md:z-[155] max-md:max-h-[85dvh] max-md:animate-rise max-md:overflow-y-auto max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0',
                'md:w-[var(--panel-w)] md:max-w-[calc(100vw-2rem)] md:animate-fade-in md:rounded-2xl',
                pos ? 'md:left-[var(--panel-left)] md:top-[var(--panel-top)]' : 'md:right-4 md:top-[58px]',
              ].join(' ')
            : 'absolute z-50 w-[var(--panel-w)] max-w-[calc(100vw-2rem)] animate-fade-in rounded-2xl',
          className ?? '',
        ].join(' ')}
      >
        {children}
      </div>
    </>
  );
}
