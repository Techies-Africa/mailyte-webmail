import type { NextConfig } from 'next';

// Static, path-independent security headers. Carried across from the
// application this was extracted from, minus the pieces that only made sense
// there (a CSP nonce and per-path frame-ancestors for an embed widget that
// does not exist in this repo).
//
// The request proxy (proxy.ts) is not here either: it refuses mailbox requests
// meant for an account the session cookie no longer makes active.
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
  experimental: {
    // With a proxy in place, Next buffers each request body so both the proxy
    // and the route can read it -- and past this size it keeps only the first
    // part and carries on, without an error. A send carries up to 25 MB of
    // attachments plus the message itself, so the default 10 MB cut messages
    // short. This leaves room for both.
    proxyClientMaxBodySize: '30mb',
  },
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
