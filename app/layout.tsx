import type { Metadata } from 'next';
import { IBM_Plex_Mono, Manrope, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import AccentTheme from '@/components/providers/AccentTheme';
import { ToastProvider } from '@/components/ui/Toast';
import { brand } from '@/lib/webmail/brand';

/**
 * The three families the brand guide names, self-hosted by next/font so no
 * request ever leaves for a font CDN at run time.
 *
 *   Manrope        every piece of UI copy
 *   Space Grotesk  headings, the subject line, the folder title, numbers
 *   IBM Plex Mono  addresses, eyebrows, anything an engineer would copy
 */
const body = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-body',
});

const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  variable: '--font-display',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: brand.name,
  description: 'Read and send mail from your own mail server.',
  // A webmail is a private surface; there is nothing here for a crawler.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/logo-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes sets the class on <html> before
    // React hydrates, which is the intended behaviour and would otherwise be
    // reported as a mismatch on every page load.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${body.variable} ${display.variable} ${mono.variable}`}
    >
      <body suppressHydrationWarning>
        <ThemeProvider>
          <AccentTheme />
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
