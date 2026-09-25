/**
 * How wide the rail and the message list are, and whether the rail is
 * collapsed to icons.
 *
 * Both widths are the person's to drag (PaneResizeHandle) and are remembered
 * per browser -- they depend on the screen in front of them, so they are the
 * same kind of preference as the collapsed rail and the accent, not a mailbox
 * setting. The reading pane is simply what is left.
 *
 * The values live in three places, deliberately:
 *
 *   localStorage          what the person chose, across visits
 *   <html> attributes     `data-rail="collapsed"` and `--rail-w` / `--list-w`,
 *                         copied in by PANE_LAYOUT_SCRIPT in <head> before the
 *                         first paint, then kept current by the handles
 *   app/globals.css       what the panes ARE: the chosen widths held back with
 *                         clamp() so the reading pane keeps its minimum while
 *                         the window allows it
 *
 * React never renders a width. The rail on Calendar, Contacts and Settings is
 * server-rendered, and a width read from storage during render would either
 * mismatch the server's HTML or flash from the default to the stored value
 * after hydration; a CSS variable set before paint does neither.
 *
 * No 'use client': app/layout.tsx is a Server Component and needs the script
 * as a real string, not a client reference.
 *
 * The numbers are repeated in app/globals.css. Change both together.
 */

/** Today's width, and always the phone drawer's width. */
export const RAIL_DEFAULT = 228;
/** Icons only. */
export const RAIL_COLLAPSED = 58;
/** The lockup and the collapse button still fit; folder names truncate. */
export const RAIL_MIN = 200;
/** The rail's cap on an ordinary screen: every screen up to 1800px keeps exactly this. */
export const RAIL_MAX = 360;
/**
 * On a wider screen the cap grows with it, to this share of the window: an
 * ultrawide (3440px) has room a laptop does not, and may take the rail to
 * 688px.
 */
export const RAIL_MAX_SHARE = 0.2;

export const LIST_DEFAULT = 360;
/** The bulk-selection bar needs about 300px; rows truncate at any width. */
export const LIST_MIN = 320;
/** The list's cap on an ordinary screen (up to 1600px); a wider one allows LIST_MAX_SHARE of it -- 1376px at 3440px. */
export const LIST_MAX = 640;
export const LIST_MAX_SHARE = 0.4;

/**
 * The widest a stored width is read back as: a sanity bound past any real
 * screen, not a limit. What a pane may be on THIS screen is railMaxFor /
 * listMaxFor, and globals.css holds it to the same. A width chosen on an
 * ultrawide survives a visit from a laptop, where it shows at the laptop's cap.
 */
export const PANE_CEILING = 4000;

/**
 * What the reading pane keeps while the window allows. A soft floor: at 768px
 * the rail and list floors alone leave less, and they win (see globals.css).
 * 420 leaves the default layout exactly as it was at 1008px and wider.
 */
export const READING_MIN = 420;

/** Arrow keys on a focused handle, and Shift+arrow. */
export const KEY_STEP = 10;
export const KEY_STEP_LARGE = 50;

/** Unchanged from before the rail could be dragged, so existing choices survive. */
export const RAIL_COLLAPSED_KEY = 'mailyte.webmail.sidebarCollapsed';
export const RAIL_WIDTH_KEY = 'mailyte.webmail.railWidth';
export const LIST_WIDTH_KEY = 'mailyte.webmail.listWidth';

/** For aria-controls on the handles and the Menu buttons. */
export const SIDEBAR_ID = 'webmail-sidebar';
export const LIST_PANE_ID = 'webmail-message-list';

/**
 * Set on <html> while something is being dragged -- a pane edge or a compose
 * window. globals.css uses it to stop email iframes swallowing the pointer
 * (pointer capture alone does not keep events out of an iframe in every
 * browser), to stop text selecting, and to switch the rail's width
 * transition off so it follows the pointer instead of trailing it. The value
 * is the cursor to hold everywhere meanwhile.
 */
export const DRAGGING_ATTR = 'data-dragging';
export type DraggingCursor = 'col-resize' | 'grabbing';

/**
 * Fired on window when a pane drag ends. The message frame re-fits a wide
 * email to its new width once, here, instead of on every frame of the drag.
 */
export const PANE_RESIZE_END_EVENT = 'mailyte:pane-resize-end';

export type PaneId = 'rail' | 'list';

export const PANES: Record<
  PaneId,
  { key: string; cssVar: '--rail-w' | '--list-w'; min: number; max: number; ceiling: number; fallback: number }
> = {
  rail: { key: RAIL_WIDTH_KEY, cssVar: '--rail-w', min: RAIL_MIN, max: RAIL_MAX, ceiling: PANE_CEILING, fallback: RAIL_DEFAULT },
  list: { key: LIST_WIDTH_KEY, cssVar: '--list-w', min: LIST_MIN, max: LIST_MAX, ceiling: PANE_CEILING, fallback: LIST_DEFAULT },
};

export const between = (lo: number, value: number, hi: number) => Math.max(lo, Math.min(hi, value));

/**
 * The widest the rail can be now: its cap -- 360px, or RAIL_MAX_SHARE of a
 * wider window -- held back so the list's floor and the reading pane still
 * fit. Mirrors --rail-now.
 */
export const railMaxFor = (viewport: number) =>
  between(RAIL_MIN, viewport - LIST_MIN - READING_MIN, Math.max(RAIL_MAX, viewport * RAIL_MAX_SHARE));

/** The widest the list can be beside a rail this wide: 640px or LIST_MAX_SHARE of the window, if the reading pane keeps its floor. Mirrors --list-now. */
export const listMaxFor = (viewport: number, rail: number) =>
  between(LIST_MIN, viewport - rail - READING_MIN, Math.max(LIST_MAX, viewport * LIST_MAX_SHARE));

/** The stored width, clamped; null when nothing is stored. Never throws. */
export function readPaneWidth(pane: PaneId): number | null {
  if (typeof window === 'undefined') return null;
  const spec = PANES[pane];
  try {
    const n = parseInt(window.localStorage.getItem(spec.key) ?? '', 10);
    return Number.isNaN(n) ? null : between(spec.min, n, spec.ceiling);
  } catch {
    // Blocked storage -- the default is a fine answer.
    return null;
  }
}

export function storePaneWidth(pane: PaneId, px: number): void {
  if (typeof window === 'undefined') return;
  const spec = PANES[pane];
  try {
    // The default is stored as nothing, so a later change of default reaches
    // everyone who never dragged.
    if (Math.round(px) === spec.fallback) window.localStorage.removeItem(spec.key);
    else window.localStorage.setItem(spec.key, String(Math.round(px)));
  } catch {
    // Not fatal: the width holds for this page load regardless.
  }
}

/**
 * Write a width onto <html>, or clear it back to the default. Through
 * setProperty, never by replacing `style`: next-themes writes color-scheme to
 * the same attribute.
 */
export function applyPaneWidth(pane: PaneId, px: number | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { cssVar } = PANES[pane];
  if (px === null) root.style.removeProperty(cssVar);
  else root.style.setProperty(cssVar, `${Math.round(px)}px`);
}

export function readRailCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(RAIL_COLLAPSED_KEY) === '1';
  } catch {
    // Private mode; stays open.
    return false;
  }
}

export function storeRailCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Not worth failing a click over.
  }
}

export function applyRailCollapsed(collapsed: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (collapsed) root.setAttribute('data-rail', 'collapsed');
  else root.removeAttribute('data-rail');
}

/** Everything the <head> script does, for when React has wiped it (see PaneLayout). */
export function applyStoredPaneLayout(): void {
  applyRailCollapsed(readRailCollapsed());
  applyPaneWidth('rail', readPaneWidth('rail'));
  applyPaneWidth('list', readPaneWidth('list'));
}

/**
 * What globals.css makes of the variables right now, in px: the same clamps,
 * computed rather than measured, so a rail halfway through its width
 * transition never reports a half-width to a drag that starts on it.
 */
export function paneWidthsNow(): { rail: number; list: number; railMax: number; listMax: number } {
  const root = document.documentElement;
  const style = window.getComputedStyle(root);
  // innerWidth, like 100vw, includes a scrollbar; the shell has none.
  const viewport = window.innerWidth;
  const px = (name: string, fallback: number) => parseFloat(style.getPropertyValue(name)) || fallback;
  const railMax = railMaxFor(viewport);
  const rail =
    root.getAttribute('data-rail') === 'collapsed'
      ? RAIL_COLLAPSED
      : between(RAIL_MIN, px('--rail-w', RAIL_DEFAULT), railMax);
  const listMax = listMaxFor(viewport, rail);
  return { rail, list: between(LIST_MIN, px('--list-w', LIST_DEFAULT), listMax), railMax, listMax };
}

/**
 * Runs in <head> before the first paint (app/layout.tsx). ES5, no imports,
 * the same clamps as readPaneWidth. A try around everything: storage can
 * throw, and a layout script that throws would take nothing else down but
 * would leave the defaults, which is the right fallback anyway.
 */
export const PANE_LAYOUT_SCRIPT = [
  '(function(){try{var d=document.documentElement,s=window.localStorage;',
  `if(s.getItem(${JSON.stringify(RAIL_COLLAPSED_KEY)})==='1')d.setAttribute('data-rail','collapsed');`,
  'function w(k,p,lo,hi){var n=parseInt(s.getItem(k)||"",10);if(!isNaN(n))d.style.setProperty(p,Math.min(hi,Math.max(lo,n))+"px")}',
  `w(${JSON.stringify(RAIL_WIDTH_KEY)},'--rail-w',${RAIL_MIN},${PANE_CEILING});`,
  `w(${JSON.stringify(LIST_WIDTH_KEY)},'--list-w',${LIST_MIN},${PANE_CEILING});`,
  '}catch(e){}})();',
].join('');
