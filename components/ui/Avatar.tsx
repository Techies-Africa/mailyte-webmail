'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { avatarStyle, hueFor, initialsFor } from '@/lib/webmail/avatar';

type AvatarProps = {
  name: string;
  email: string;
  /** Pixel size of the disc. */
  size?: number;
  className?: string;
  /** Force the dark palette (the sidebar is dark in both themes). */
  onDark?: boolean;
};

/**
 * A coloured initials disc.
 *
 * Reads the theme so the same hue lands as a pastel on white and a deep tint
 * on ink. Before mount it draws the light palette -- the first paint must
 * match the server's, and next-themes has not resolved yet.
 */
export default function Avatar({ name, email, size = 26, className, onDark }: AvatarProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = onDark ?? (mounted && resolvedTheme === 'dark');
  const hue = hueFor(email || name);
  const initials = initialsFor(name, email);

  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.38)),
        ...avatarStyle(hue, dark),
      }}
    >
      {initials}
    </span>
  );
}
