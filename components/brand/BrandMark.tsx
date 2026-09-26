/* eslint-disable @next/next/no-img-element */
import { brand } from '@/lib/webmail/brand';

/**
 * The Mailyte mark: the continuous "M" from the 2026 brand guide.
 *
 * Two raster variants ship in public/ -- one drawn for a light ground and one
 * for a dark ground -- because the mark carries a gradient in its fold that a
 * CSS mask would flatten. `tone` picks the variant explicitly rather than
 * following the page theme, since the sidebar is dark in both themes.
 *
 * Sizing is by height; the artwork keeps its own proportion.
 */
export interface BrandMarkProps {
  height?: number;
  /** Which ground the mark sits on. */
  tone?: 'light' | 'dark';
  className?: string;
  /** Accessible name. Beside the wordmark the mark is decorative. */
  title?: string;
}

export default function BrandMark({ height = 28, tone = 'light', className, title }: BrandMarkProps) {
  return (
    <img
      src={tone === 'dark' ? '/mailyte-mark-dark.png' : '/mailyte-mark-light.png'}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      style={{ height, width: 'auto' }}
      className={className ? `block shrink-0 ${className}` : 'block shrink-0'}
      draggable={false}
    />
  );
}

/**
 * Mark + name.
 *
 * When this deployment calls itself Mailyte the real lockup artwork is used,
 * wordmark and all. Anyone who rebranded through NEXT_PUBLIC_BRAND_NAME gets
 * the mark beside their own name set in the display face -- the lockup bakes
 * the word "Mailyte" into its pixels and must not be shown under another name.
 */
export function BrandLockup({
  height = 24,
  tone = 'light',
  className,
}: {
  height?: number;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const isMailyte = brand.name.trim().toLowerCase() === 'mailyte';

  if (isMailyte) {
    return (
      <img
        src={tone === 'dark' ? '/mailyte-lockup-dark.png' : '/mailyte-lockup-light.png'}
        alt={brand.name}
        style={{ height, width: 'auto' }}
        className={className ? `block shrink-0 ${className}` : 'block shrink-0'}
        draggable={false}
      />
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <BrandMark height={height} tone={tone} />
      <span
        className={`font-display font-semibold tracking-tight ${
          tone === 'dark' ? 'text-white' : 'text-foreground'
        }`}
        style={{ fontSize: Math.round(height * 0.8) }}
      >
        {brand.name}
      </span>
    </span>
  );
}
