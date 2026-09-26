import type { Metadata, Viewport } from 'next';
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
  // The icons live in public/ only -- an app/favicon.ico or app/apple-icon.png
  // gets emitted as well and drifts from these. ?v= is the cache-buster:
  // browsers keep favicons by URL, so bump it whenever an icon is replaced.
  icons: {
    icon: [
      { url: '/favicon.ico?v=2026', sizes: 'any' },
      { url: '/logo-192.png?v=2026', type: 'image/png', sizes: '192x192' },
    ],
    apple: '/apple-touch-icon.png?v=2026',
  },
};

/**
 * Only what differs from Next's default (width=device-width, initial-scale=1),
 * which it merges this over.
 *
 * resizes-content: Android Chrome shrinks the layout for its keyboard, so a
 * full-screen compose window and the bottom sheets keep their buttons above
 * it instead of under it. iOS ignores it (compose handles iOS itself).
 *
 * Not here, on purpose: maximumScale / userScalable -- they stop people
 * pinch-zooming, an accessibility failure; iOS zooming into a small field is
 * fixed in globals.css instead. viewportFit 'cover' -- it needs safe-area
 * padding everywhere, and this is not an installed app. themeColor -- a media
 * query follows the device's theme, not the one chosen in the app.
 */
export const viewport: Viewport = { interactiveWidget: 'resizes-content' };

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
