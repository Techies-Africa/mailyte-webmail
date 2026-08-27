import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import { mailboxToken } from '@/lib/webmail/server';

/**
 * Server-side fetch for remote images in message bodies.
 *
 * Exists because rendering a remote image with a plain <img> does not work
 * for every sender: Anthropic (and anyone else who serves their mail assets
 * with `Cross-Origin-Resource-Policy: same-origin`) makes the browser fetch
 * the bytes and then refuse to hand them to our renderer — the network tab
 * shows a completed download and the message shows a broken icon. CORP is
 * enforced by the browser and cannot be overridden from the page, so the
 * only way to show those images is to fetch them from an origin of our own.
 * This is the same design every large webmail uses (Gmail's
 * googleusercontent proxy), and it improves privacy as a side effect: after
 * the reader opts in, the sender's server sees this host's address, not the
 * reader's.
 *
 * Threat model — this endpoint fetches attacker-chosen URLs from inside the
 * mail stack's network, so it must not become an SSRF hole:
 *  - session-gated: only a logged-in mailbox holder can use it at all
 *  - http(s) on default ports only — no poking internal service ports
 *  - every hostname is resolved and every resolved address must be public;
 *    internal services here resolve to RFC1918 addresses, so both literal
 *    IPs and service names (mysql, dovecot, ...) fail this check
 *  - redirects are followed manually and each hop is re-validated
 *  - the response must declare an image/* type and fit the size cap
 */

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

function isPrivateAddress(address: string): boolean {
  // v4-mapped v6 (::ffff:10.0.0.1) normalises to the dotted quad.
  const v4 = address.replace(/^::ffff:/i, '');
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast + reserved
    );
  }
  const lower = address.toLowerCase();
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  );
}

async function validateTarget(url: URL): Promise<string | null> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'Only http(s) images are proxied';
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    return 'Non-default ports are not proxied';
  }
  if (url.username || url.password) {
    return 'Credentials in image URLs are not proxied';
  }
  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return 'Host did not resolve';
    for (const { address } of addresses) {
      if (isPrivateAddress(address)) return 'Host resolves to a private address';
    }
  } catch {
    return 'Host did not resolve';
  }
  return null;
}

export async function GET(request: NextRequest) {
  const token = await mailboxToken();
  if (!token) {
    return NextResponse.json({ success: false, message: 'Not logged in' }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get('url') ?? '';
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid url' }, { status: 400 });
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = await validateTarget(target);
    if (problem) {
      return NextResponse.json({ success: false, message: problem }, { status: 400 });
    }

    let upstream: Response;
    try {
      upstream = await fetch(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // No conditional/cookie/referrer state of the reader's ever leaves
        // here — the request is anonymous by construction.
        headers: { Accept: 'image/*' },
        cache: 'no-store',
      });
    } catch {
      return NextResponse.json({ success: false, message: 'Image fetch failed' }, { status: 502 });
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location || hop === MAX_REDIRECTS) {
        return NextResponse.json({ success: false, message: 'Too many redirects' }, { status: 502 });
      }
      try {
        target = new URL(location, target);
      } catch {
        return NextResponse.json({ success: false, message: 'Invalid redirect' }, { status: 502 });
      }
      continue;
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { success: false, message: `Upstream answered ${upstream.status}` },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return NextResponse.json({ success: false, message: 'Not an image' }, { status: 502 });
    }

    const declared = Number(upstream.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) {
      return NextResponse.json({ success: false, message: 'Image too large' }, { status: 502 });
    }

    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ success: false, message: 'Image too large' }, { status: 502 });
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  return NextResponse.json({ success: false, message: 'Too many redirects' }, { status: 502 });
}
