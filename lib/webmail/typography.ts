/**
 * The viewer's text size and font family.
 *
 * Sibling of accent.ts, and the same split: identity, clamps and storage here;
 * the actual font stacks for the app live in app/globals.css, keyed off
 * `data-font` on <html>. The size is a single `--font-scale` custom property
 * that postcss/scale-type.mjs has already wired into every font-size and
 * line-height in the stylesheet, so nothing here has to know about px values.
 *
 * Both are per-device, like the accent and the pane widths: they depend on the
 * screen and the eyes in front of them, not on the mailbox.
 *
 * The one asymmetry with accent.ts is `frameStack` below, which has to live in
 * TS rather than CSS -- see its comment.
 */

export type FontId = 'system' | 'inter' | 'plex' | 'lexend' | 'atkinson' | 'serif' | 'mono';

/** Every non-default id. Used by the type guard and by the pre-paint script. */
export const FONT_IDS: readonly FontId[] = [
  'system',
  'inter',
  'plex',
  'lexend',
  'atkinson',
  'serif',
  'mono',
];

/**
 * The stack the MESSAGE FRAME gets. Not the same thing as the app's font, and
 * not a mistake.
 *
 * The frame is a separate srcDoc document: custom properties do not cross into
 * it, and neither do next/font's @font-face rules -- so a downloaded family
 * cannot render inside a message at all, only a font already on the device can.
 * Each option therefore maps to the nearest GENERIC family, which every device
 * has. Picking a serif or a mono changes how mail reads; the webfont sans
 * choices leave mail on the system sans it already used.
 *
 * Do not "fix" this by injecting @font-face or linking the parent stylesheet
 * into the frame.
 */
const FRAME_SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const FRAME_SERIF = 'ui-serif, Georgia, "Times New Roman", serif';
const FRAME_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export interface FontChoice {
  /** null is the shipped pair (Manrope + Space Grotesk) and carries no attribute. */
  id: FontId | null;
  name: string;
  note: string;
  /**
   * A font-family value for previewing this option in the picker. Never the
   * app's own --font-body: once another font is chosen that property IS the
   * choice, so the default card would preview whatever was picked instead of
   * Manrope.
   */
  preview: string;
  /** What the message frame uses; see FRAME_SANS above. */
  frameStack: string;
}

export const DEFAULT_FONT: FontId | null = null;

export const FONTS: readonly FontChoice[] = [
  {
    id: null,
    name: 'Mailyte',
    note: 'Manrope and Space Grotesk.',
    preview: 'var(--font-manrope)',
    frameStack: FRAME_SANS,
  },
  {
    id: 'system',
    name: 'System',
    note: "Your device's own interface font.",
    preview: FRAME_SANS,
    frameStack: FRAME_SANS,
  },
  {
    id: 'inter',
    name: 'Inter',
    note: 'Crisp and neutral at small sizes.',
    preview: 'var(--font-inter)',
    frameStack: FRAME_SANS,
  },
  {
    id: 'plex',
    name: 'IBM Plex Sans',
    note: 'Warmer; easy over long mail.',
    preview: 'var(--font-plex)',
    frameStack: FRAME_SANS,
  },
  {
    id: 'lexend',
    name: 'Lexend',
    note: 'Shaped to reduce reading effort.',
    preview: 'var(--font-lexend)',
    frameStack: FRAME_SANS,
  },
  {
    id: 'atkinson',
    // Only 400 and 700 exist, so 500 and 600 are synthesised. Accepted: the
    // point of this one is letterform clarity, not weight range.
    name: 'Atkinson Hyperlegible',
    note: 'Built for low vision.',
    preview: 'var(--font-atkinson)',
    frameStack: FRAME_SANS,
  },
  {
    id: 'serif',
    name: 'Source Serif',
    note: 'Reads like a document.',
    preview: 'var(--font-source-serif)',
    frameStack: FRAME_SERIF,
  },
  {
    id: 'mono',
    name: 'JetBrains Mono',
    note: 'Everything fixed-width.',
    preview: 'var(--font-jetbrains)',
    frameStack: FRAME_MONO,
  },
] as const;

/** Percentages. 85 keeps the 12.5px UI readable; past 130 fixed-height controls clip. */
export const SCALE_MIN = 85;
export const SCALE_MAX = 130;
export const SCALE_STEP = 5;
export const DEFAULT_SCALE = 100;

export const FONT_STORAGE_KEY = 'mailyte-webmail-font';
export const SCALE_STORAGE_KEY = 'mailyte-webmail-font-scale';

export function isFontId(value: unknown): value is FontId {
  return typeof value === 'string' && (FONT_IDS as readonly string[]).includes(value);
}

/** Snapped to a step and held inside the range. */
export const clampScale = (n: number): number =>
  Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(n / SCALE_STEP) * SCALE_STEP));

export function frameStackFor(id: FontId | null): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).frameStack;
}

/**
 * Stamp the font onto the document.
 *
 * The default carries no attribute at all, so the shipped pair is whatever
 * `:root` says and nothing has to be undone to get back to it.
 */
export function applyFont(id: FontId | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (id === null) root.removeAttribute('data-font');
  else root.setAttribute('data-font', id);
}

/**
 * Write the scale onto <html>.
 *
 * Through setProperty, never by replacing `style`: next-themes writes
 * color-scheme to the same attribute (the same warning as paneLayout.ts).
 */
export function applyScale(percent: number): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (percent === DEFAULT_SCALE) root.style.removeProperty('--font-scale');
  else root.style.setProperty('--font-scale', String(percent / 100));
}

/** The viewer's stored font, or the shipped default. Never throws. */
export function readFont(): FontId | null {
  if (typeof window === 'undefined') return DEFAULT_FONT;
  try {
    const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
    return isFontId(stored) ? stored : DEFAULT_FONT;
  } catch {
    // Blocked storage -- the shipped font is a fine answer.
    return DEFAULT_FONT;
  }
}

/** The viewer's stored size, clamped, or 100. Never throws. */
export function readScale(): number {
  if (typeof window === 'undefined') return DEFAULT_SCALE;
  try {
    const n = parseInt(window.localStorage.getItem(SCALE_STORAGE_KEY) ?? '', 10);
    return Number.isNaN(n) ? DEFAULT_SCALE : clampScale(n);
  } catch {
    return DEFAULT_SCALE;
  }
}

export function storeFont(id: FontId | null): void {
  if (typeof window === 'undefined') return;
  try {
    // The default is stored as nothing, so a later change of default reaches
    // everyone who never chose.
    if (id === null) window.localStorage.removeItem(FONT_STORAGE_KEY);
    else window.localStorage.setItem(FONT_STORAGE_KEY, id);
  } catch {
    // Not fatal: it is applied for this page load regardless.
  }
}

export function storeScale(percent: number): void {
  if (typeof window === 'undefined') return;
  try {
    if (percent === DEFAULT_SCALE) window.localStorage.removeItem(SCALE_STORAGE_KEY);
    else window.localStorage.setItem(SCALE_STORAGE_KEY, String(percent));
  } catch {
    // As above.
  }
}

/**
 * What <html> currently says, read straight from the DOM.
 *
 * For the message frame, which must build its srcDoc with the right size on
 * its FIRST render: reading localStorage during render would mismatch the
 * server's HTML, and reading it in an effect would rewrite srcDoc and remount
 * the iframe on every message opened. The pre-paint script below has already
 * put the truth on <html>, so reading the DOM here is correct and free. Same
 * trick the frame already uses for dark mode ("Seeded from the <html> class").
 */
export function typographyFromRoot(): { font: FontId | null; scale: number } {
  if (typeof document === 'undefined') return { font: DEFAULT_FONT, scale: DEFAULT_SCALE };
  const root = document.documentElement;
  const attr = root.getAttribute('data-font');
  const raw = parseFloat(root.style.getPropertyValue('--font-scale'));
  return {
    font: isFontId(attr) ? attr : DEFAULT_FONT,
    scale: Number.isNaN(raw) ? DEFAULT_SCALE : clampScale(raw * 100),
  };
}

/** Everything the <head> script does, for when React has wiped it (see Typography.tsx). */
export function applyStoredTypography(): void {
  applyFont(readFont());
  applyScale(readScale());
}

/**
 * Runs in <head> before the first paint (app/layout.tsx). ES5, no imports, the
 * same clamp as readScale. A try around everything: storage can throw, and a
 * script that throws would leave the defaults, which is the right fallback.
 */
export const TYPOGRAPHY_SCRIPT = [
  '(function(){try{var d=document.documentElement,s=window.localStorage;',
  `var ids=${JSON.stringify(FONT_IDS)};`,
  `var f=s.getItem(${JSON.stringify(FONT_STORAGE_KEY)});`,
  "if(f&&ids.indexOf(f)>-1)d.setAttribute('data-font',f);",
  `var n=parseInt(s.getItem(${JSON.stringify(SCALE_STORAGE_KEY)})||"",10);`,
  `if(!isNaN(n)&&n!==${DEFAULT_SCALE}){`,
  `n=Math.min(${SCALE_MAX},Math.max(${SCALE_MIN},n));`,
  "d.style.setProperty('--font-scale',String(n/100));}",
  '}catch(e){}})();',
].join('');
