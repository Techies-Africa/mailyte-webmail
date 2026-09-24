import type { Metadata } from 'next';
import { IBM_Plex_Mono, Manrope, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import AccentTheme from '@/components/providers/AccentTheme';
import OutboxProvider from '@/components/providers/OutboxProvider';
import PaneLayout from '@/components/providers/PaneLayout';
import QueryProvider from '@/components/providers/QueryProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { brand } from '@/lib/webmail/brand';
import { PANE_LAYOUT_SCRIPT } from '@/lib/webmail/paneLayout';

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
    // React hydrates, and the pane script below sets data-rail and the
    // --rail-w / --list-w variables. Both are intended, and would otherwise be
    // reported as a mismatch on every page load.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${body.variable} ${display.variable} ${mono.variable}`}
    >
      <head>
        {/* The remembered pane widths and collapsed rail, copied from
            localStorage onto <html> before the first paint, so a
            server-rendered rail (Calendar, Contacts, Settings) and the inbox
            skeleton are drawn at their size with no jump. An inline script is
            fine here: there is no Content Security Policy (next.config.ts),
            and the root layout never re-renders on a client navigation, so
            what it sets persists. */}
        <script dangerouslySetInnerHTML={{ __html: PANE_LAYOUT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <AccentTheme />
          <PaneLayout />
          {/* Inside the toasts: mutations report through useToast. */}
          <ToastProvider>
            <QueryProvider>
              {/* The undo-send window, held above every page. */}
              <OutboxProvider>{children}</OutboxProvider>
            </QueryProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
