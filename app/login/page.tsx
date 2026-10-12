import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { ProductionAnalytics } from '@/components/ProductionAnalytics';
import { brand } from '@/lib/webmail/brand';
import { turnstileKeys } from '@/lib/webmail/turnstile';
import LoginForm from './LoginForm';

/**
 * The one page worth a link preview. The origin comes from the request: this
 * image is published once and self-hosted anywhere, so no build-time URL is
 * right. The OG image then resolves to this host instead of localhost.
 */
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  let metadataBase: URL | undefined;
  try {
    metadataBase = new URL(`${proto}://${host}`);
  } catch {
    // A junk forwarded header: leave the URLs relative rather than 500 the login.
  }

  const title = `${brand.name} — Private Webmail`;
  const description =
    'Read and send mail from your own mail server with sub-50ms responsiveness and zero tracking.';
  return {
    title: 'Sign in',
    metadataBase,
    openGraph: {
      type: 'website',
      siteName: brand.name,
      locale: 'en_US',
      url: '/login',
      title,
      description,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: `${brand.name} Webmail` }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
  };
}

/**
 * Rendered per request, not once at build: the Turnstile site key is set
 * where the container runs, like MAILBOX_API_BASE_URL, and a page
 * prerendered at build would carry the build machine's -- none. Only the
 * public site key crosses to the browser; the secret stays in the login route.
 */
export default async function LoginPage() {
  await connection();
  return (
    <>
      {/* The one page analytics runs on (components/ProductionAnalytics). */}
      <ProductionAnalytics />
      <LoginForm turnstileSiteKey={turnstileKeys()?.siteKey ?? ''} />
    </>
  );
}
