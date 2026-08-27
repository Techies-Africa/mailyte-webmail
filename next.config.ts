import type { NextConfig } from 'next';

// Static, path-independent security headers. Carried across from the
// application this was extracted from, minus the pieces that only made sense
// there (a CSP nonce and per-path frame-ancestors for an embed widget that
// does not exist in this repo).
//
// Note what is NOT here: no middleware. The original needed one only to
// EXEMPT /webmail from an admin session check. There is no admin session to
// be exempted from, so the file is gone rather than emptied.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // A webmail renders other people's HTML. It should never itself be framed.
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  // Required by the Dockerfile: emits a self-contained server bundle so the
  // runtime image does not need node_modules.
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    // The app used to live under /webmail, which on a host already called
    // webmail.example.com read as webmail.example.com/webmail. It is served
    // from the root now; these keep old bookmarks, and any link already sent
    // to someone, working.
    return [
      { source: '/webmail', destination: '/', permanent: true },
      { source: '/webmail/:path*', destination: '/:path*', permanent: true },
    ];
  },
};

export default nextConfig;
