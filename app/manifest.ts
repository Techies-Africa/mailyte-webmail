import type { MetadataRoute } from 'next';
import { brand } from '@/lib/webmail/brand';

/**
 * The web app manifest, served at /manifest.webmanifest; Next links it from
 * every page itself. Without one no browser offers "Install app" (feedback
 * 2026-10-07): Chrome wants a name, a 192px and a 512px icon, a start_url
 * and a standalone display. No service worker -- an install prompt no longer
 * needs offline support, and this app has none to offer.
 *
 * The icons are the rounded tiles in public/, transparent at the corners,
 * so `any` and not `maskable`: a mask would clip the M.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: brand.name,
    short_name: brand.name,
    description: 'Read and send mail from your own mail server.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    icons: [
      { src: '/logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
