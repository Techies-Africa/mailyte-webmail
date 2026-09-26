/**
 * Initials and a stable hue for a sender.
 *
 * The redesign gives every row a coloured initials disc. The hue is a hash of
 * the ADDRESS, not the display name, so the same person keeps the same colour
 * whether they wrote as "Ada" or "Ada Lovelace" -- and so the colour is the
 * same on every device without anything being stored.
 */

export function initialsFor(name: string, email: string): string {
  const source = (name || email || '').trim();
  if (!source) return '?';

  // "Ada Lovelace" -> AL; "ada@x.com" -> AD; "Anthropic, PBC" -> AP.
  const words = source
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return source.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function hueFor(key: string): number {
  let hash = 0;
  const value = (key || '').toLowerCase();
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/** Inline styles for a disc: pastel ground, deep ink, both from one hue. */
export function avatarStyle(hue: number, dark: boolean): { background: string; color: string } {
  return dark
    ? { background: `hsl(${hue} 40% 24%)`, color: `hsl(${hue} 70% 82%)` }
    : { background: `hsl(${hue} 55% 91%)`, color: `hsl(${hue} 55% 32%)` };
}
