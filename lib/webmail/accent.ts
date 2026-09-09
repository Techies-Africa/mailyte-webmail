/**
 * Accent themes for the webmail.
 *
 * Colour VALUES are not here. They live in app/globals.css as custom
 * properties, one block per theme:
 *
 *     :root                        → the shipped accent (indigo), light
 *     .dark                        → the shipped accent, dark
 *     :root[data-theme='teal']     → an alternate, light
 *     :root[data-theme='teal'].dark→ the same alternate, dark
 *
 * This module knows only theme identities. Switching stamps `data-theme` on
 * <html>, which means dark mode falls out of the existing cascade rather than
 * being computed here — and every accent needs a different value in dark,
 * because one chosen to carry a white label on white is invisible on a dark
 * ground.
 *
 * Separate from `brand.ts` next door, which is what this deployment CALLS
 * itself (name and mark, env-driven at build time). This is what it looks
 * like, chosen per viewer at run time.
 *
 * Kept in step with mailyte-web and mailyte-console: same ids, same values.
 * The three are separate repos, so this is duplicated rather than shared.
 */

export type AccentId = 'indigo' | 'magenta' | 'teal' | 'azure' | 'violet' | 'gold';

export interface Accent {
  id: AccentId;
  name: string;
  /** For the picker chip only. The real value is the CSS custom property. */
  swatch: string;
  note: string;
}

export const DEFAULT_ACCENT: AccentId = 'indigo';

export const ACCENT_STORAGE_KEY = 'mailyte-webmail-accent';

export const ACCENTS: readonly Accent[] = [
  { id: 'indigo', name: 'Indigo', swatch: '#3730A3', note: 'The Mailyte default.' },
  { id: 'magenta', name: 'Magenta', swatch: '#A81D94', note: 'Deep magenta.' },
  { id: 'teal', name: 'Teal', swatch: '#0D7490', note: 'Calm and technical.' },
  { id: 'azure', name: 'Azure', swatch: '#1D4ED8', note: 'Confident blue.' },
  { id: 'violet', name: 'Violet', swatch: '#7C3AED', note: 'Bright violet.' },
  { id: 'gold', name: 'Gold', swatch: '#DBA500', note: 'What Mailyte wore before the rebrand.' },
] as const;

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && ACCENTS.some((a) => a.id === value);
}

/**
 * Stamp an accent onto the document.
 *
 * The default carries no attribute at all, so the shipped accent is whatever
 * `:root` says and nothing has to be undone to get back to it.
 */
export function applyAccent(id: AccentId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (id === DEFAULT_ACCENT) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', id);
}

/** The viewer's stored choice, or the shipped default. Never throws. */
export function readAccent(): AccentId {
  if (typeof window === 'undefined') return DEFAULT_ACCENT;
  try {
    const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccentId(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    // Blocked storage — the shipped accent is a fine answer.
    return DEFAULT_ACCENT;
  }
}

export function storeAccent(id: AccentId): void {
  if (typeof window === 'undefined') return;
  try {
    if (id === DEFAULT_ACCENT) window.localStorage.removeItem(ACCENT_STORAGE_KEY);
    else window.localStorage.setItem(ACCENT_STORAGE_KEY, id);
  } catch {
    // Not fatal: the accent is applied for this page load regardless.
  }
}
