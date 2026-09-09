/**
 * The Mailyte mark.
 *
 * Two CSS layers on `.brand-mark` (app/globals.css): the wing is an alpha
 * mask painted with the accent token, so it follows Settings → Appearance and
 * picks up the lifted value in dark; the plane keeps its own pixels.
 *
 * Sizing: pass `height`. The width follows the artwork's 642:468 proportion
 * via `aspect-ratio` in the stylesheet, so a caller cannot stretch it.
 */
export interface BrandMarkProps {
  /** Rendered height in pixels. Width follows the artwork's proportion. */
  height?: number;
  className?: string;
  /**
   * Accessible name. Pass one only where the mark stands alone as the
   * product's name — beside a "Mailyte" wordmark it is decorative.
   */
  title?: string;
}

export default function BrandMark({ height = 32, className, title }: BrandMarkProps) {
  return (
    <span
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      style={{ height }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
