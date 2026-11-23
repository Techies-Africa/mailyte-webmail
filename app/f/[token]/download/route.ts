import { NextRequest } from 'next/server';
import { apiBaseUrl } from '@/lib/webmail/server';

/**
 * The shared-file page's Download button (app/f/[token]/page.tsx).
 *
 * Asks the mail server for a short-lived signed URL, counted as one download,
 * and sends the browser straight to it: the file comes from storage, never
 * through this server. Anything else goes back to the page, which says why.
 *
 * POST only does this. A GET -- someone pasting this URL, a link scanner --
 * is sent to the page, so nothing downloads or counts without a button press.
 */
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

// Relative Location: behind the proxy, this process's own idea of its URL is
// not the public one.
function to(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN.test(token)) return to('/f/invalid');
  const back = (problem: string) => to(`/f/${token}?problem=${problem}`);

  try {
    const res = await fetch(`${apiBaseUrl()}/file-links/public/${token}/download`, {
      method: 'POST',
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    const data = body?.data as { state?: string; url?: string } | undefined;
    if (res.ok && data?.state === 'available' && typeof data.url === 'string' && /^https?:\/\//.test(data.url)) {
      return to(data.url);
    }
    if (data?.state === 'busy') return back('busy');
    if (data?.state && data.state !== 'available') return to(`/f/${token}`);
    return back('error');
  } catch {
    return back('error');
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return to(TOKEN.test(token) ? `/f/${token}` : '/f/invalid');
}
