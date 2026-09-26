import type { ComposeWindow } from './types';
import { RAIL_COLLAPSED, paneWidthsNow } from '@/lib/webmail/paneLayout';

/**
 * Where each compose window sits along the bottom edge -- pure geometry, no
 * React, so the hook that owns the windows and the dock that draws them agree
 * on every number.
 *
 * The dock is ONE ordered row anchored at the bottom-right corner. The order
 * of the windows array IS the order of the slots: index 0 is the slot nearest
 * the right edge, and each slot's `right` is the running sum of the slots
 * between it and the corner. A new window is appended, so it opens at the
 * LEFT end and nothing already docked moves. Minimizing, restoring and full
 * screen change a window's shape, never its index; only a drag or the
 * keyboard move changes the order.
 *
 * When the row does not fit, the window used least recently collapses to a
 * tab IN PLACE: it keeps its slot and only narrows, so the slots beyond it
 * slide towards the corner and nothing changes order.
 */

/** An open window's width -- and the slot a full-screen one keeps, so leaving full screen moves nothing. */
export const COMPOSE_WIDTH = 560;
/** Space between neighbouring slots. */
export const COMPOSE_GAP = 12;
/** The first slot's distance from the right edge. */
export const COMPOSE_RIGHT = 32;
/** A minimized tab's width. Fixed, so the slots beyond it do not shift while its subject is typed. */
export const TAB_WIDTH = 240;
/** The narrowest a tab is squeezed to before the row is allowed to run under the rail. */
export const TAB_MIN_WIDTH = 160;
/** However wide the screen, a fourth 560px sheet is clutter rather than help. */
export const MAX_OPEN = 3;
/**
 * Docked windows and tabs stack from here, one step per window by how
 * recently it was used: above the rail and floating panels (up to 50) and
 * below full-screen compose (200), dialogs (205), the undo bar (210) and
 * toasts (220). Dialogs rise above compose on purpose -- see Dialog.
 */
export const DOCK_Z = 140;
/** A phone's tab strip keeps this far from both edges, as it always has. */
export const PHONE_EDGE = 12;
/** Matches useIsMobile: below this, one window at a time, full screen, so width is no limit. */
const MOBILE_BREAKPOINT = 768;
/** Clear space between the rail and the leftmost slot. */
const RAIL_CLEARANCE = 16;
/** Last resort when even squeezed tabs do not fit: overlap this close to the left edge rather than leave the screen. */
const EDGE_MIN = 8;

/** The fields the geometry reads. */
type Docked = Pick<ComposeWindow, 'id' | 'layout' | 'activatedAt'>;

/** One slot: its distance from the right edge of the screen and its width, both px. */
export interface Slot {
  right: number;
  width: number;
}

/** The screen the row has to fit: its width, and how far in from the left edge the row must stop. */
export interface DockViewport {
  width: number;
  inset: number;
}

/**
 * The viewport right now. The row stops short of the rail by the rail's live
 * width, so Compose and the folders stay in reach. On the server there is no
 * window: width 0 reads as "unknown, no limit", and the inset falls back to
 * the icon-only rail.
 */
export function dockViewportNow(): DockViewport {
  if (typeof window === 'undefined') return { width: 0, inset: RAIL_COLLAPSED + RAIL_CLEARANCE };
  return { width: window.innerWidth, inset: paneWidthsNow().rail + RAIL_CLEARANCE };
}

/** Open and full-screen windows take a whole slot; a minimized one only a tab. */
const takesFullSlot = (w: Docked) => w.layout !== 'minimized';

function fits(windows: Docked[], viewportWidth: number, leftInset: number): boolean {
  const full = windows.filter(takesFullSlot).length;
  if (full > MAX_OPEN) return false;
  // Unknown, or a phone: one window shows at a time, so width is no limit.
  if (viewportWidth < MOBILE_BREAKPOINT) return true;
  const need =
    full * COMPOSE_WIDTH + (windows.length - full) * TAB_MIN_WIDTH + Math.max(0, windows.length - 1) * COMPOSE_GAP;
  return need <= viewportWidth - COMPOSE_RIGHT - leftInset;
}

/**
 * Collapses open windows to tabs, least recently used first, until the row
 * fits: no more than MAX_OPEN whole slots, and the row clear of the rail.
 *
 * IN PLACE: a collapsed window keeps its index and only narrows, so nothing
 * changes order. `keepId` -- the window just opened or restored -- is never
 * collapsed, nor is a full-screen one; without a `keepId` (a resize) the most
 * recently used open window is kept. When only those are left the row is
 * allowed to overflow, and layoutSlots pulls it back on screen.
 *
 * Returns the SAME array when nothing changes, so a resize that already fits
 * is not a state change.
 */
export function fitToViewport<T extends Docked>(
  windows: T[],
  viewportWidth: number,
  leftInset: number,
  keepId?: string,
): T[] {
  let next = windows;
  while (!fits(next, viewportWidth, leftInset)) {
    const open = next.filter((w) => w.layout === 'open');
    const keep =
      keepId ?? open.reduce<T | undefined>((a, w) => (!a || w.activatedAt > a.activatedAt ? w : a), undefined)?.id;
    const candidates = open.filter((w) => w.id !== keep);
    if (candidates.length === 0) break;
    const stalest = candidates.reduce((a, w) => (w.activatedAt < a.activatedAt ? w : a));
    next = next.map((w) => (w.id === stalest.id ? { ...w, layout: 'minimized' as const } : w));
  }
  return next;
}

/**
 * Every window's slot on a desktop, by id. `windows` is in slot order, index 0
 * nearest the right edge; each `right` is a running sum from the corner.
 *
 * Tabs share whatever room the whole slots leave, between TAB_MIN_WIDTH and
 * TAB_WIDTH, and are all one width so dragging one never resizes another.
 * When even that overflows, a slot is pulled back to EDGE_MIN from the left
 * edge and overlaps its neighbour -- the most recently used draws on top --
 * rather than leave the screen.
 */
export function layoutSlots(windows: Docked[], viewportWidth: number, leftInset: number): Map<string, Slot> {
  const full = windows.filter(takesFullSlot).length;
  const tabs = windows.length - full;
  let tabWidth = TAB_WIDTH;
  if (tabs > 0 && viewportWidth > 0) {
    const room =
      viewportWidth - COMPOSE_RIGHT - leftInset - full * COMPOSE_WIDTH - Math.max(0, windows.length - 1) * COMPOSE_GAP;
    tabWidth = Math.max(TAB_MIN_WIDTH, Math.min(TAB_WIDTH, Math.floor(room / tabs)));
  }

  const slots = new Map<string, Slot>();
  let right = COMPOSE_RIGHT;
  for (const w of windows) {
    const width = takesFullSlot(w) ? COMPOSE_WIDTH : tabWidth;
    const limit = viewportWidth > 0 ? Math.max(COMPOSE_RIGHT, viewportWidth - EDGE_MIN - width) : Infinity;
    slots.set(w.id, { right: Math.min(right, limit), width });
    right += width + COMPOSE_GAP;
  }
  return slots;
}

/**
 * The index a dragged window belongs at, from where it is on screen now:
 * `right` is the distance of its right edge from the right edge of the
 * screen, `width` its width.
 *
 * It passes a neighbour once its LEADING edge crosses the neighbour's centre
 * -- the right edge when it has been pulled towards the corner, the left edge
 * when pushed away. Centre against centre would make a 560px window travel
 * 400px to pass a 190px tab; this way anything passes anything at the
 * halfway point of the overlap, however different their widths.
 *
 * It cannot flicker. Once passed, the neighbour's slot jumps to the far side
 * of the dragged one, and passing it back means moving a whole gap the other
 * way.
 */
export function slotForDrag(
  windows: Docked[],
  slots: Map<string, Slot>,
  id: string,
  right: number,
  width: number,
): number {
  const own = slots.get(id);
  const leading = own && right < own.right ? right : right + width;
  let index = 0;
  for (const w of windows) {
    if (w.id === id) continue;
    const slot = slots.get(w.id);
    if (slot && slot.right + slot.width / 2 < leading) index += 1;
  }
  return index;
}
