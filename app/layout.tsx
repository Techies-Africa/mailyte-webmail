import type { Metadata, Viewport } from 'next';
import {
  Atkinson_Hyperlegible,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inter,
  JetBrains_Mono,
  Lexend,
  Manrope,
  Source_Serif_4,
  Space_Grotesk,
} from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import AccentTheme from '@/components/providers/AccentTheme';
import Typography from '@/components/providers/Typography';
import OutboxProvider from '@/components/providers/OutboxProvider';
import PaneLayout from '@/components/providers/PaneLayout';
import QueryProvider from '@/components/providers/QueryProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { brand } from '@/lib/webmail/brand';
import { PANE_LAYOUT_SCRIPT } from '@/lib/webmail/paneLayout';
import { TYPOGRAPHY_SCRIPT } from '@/lib/webmail/typography';

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

/**
 * The families a viewer may pick instead (Settings → Appearance; ids and
 * stacks in lib/webmail/typography.ts, the data-font blocks in globals.css).
 *
 * `preload: false` on every one of them, deliberately: preloading eight
 * families on every page load to use one would be absurd. A @font-face
 * declaration costs nothing until a glyph actually matches it, so declaring
 * them all here is free for the viewer who never changes the default -- the
 * browser fetches only the family that --font-body ends up naming.
 *
 * No `weight` where the family has a variable axis (all but Atkinson), so one
 * file covers 400-700. Atkinson Hyperlegible ships only 400 and 700, so the
 * browser substitutes the nearest face (medium shows as regular, semibold as
 * bold) rather than synthesising anything; accepted, since that option is
 * chosen for letterform clarity rather than weight range.
 */
// The default card's own Manrope. --font-body is overridden the moment any other
// font is picked, so the picker could not preview the default through it. Same
// font file as `body` above, so the browser downloads nothing twice.
const optManrope = Manrope({
  subsets: ['latin'],
  weight: ['600'],
  display: 'swap',
  preload: false,
  variable: '--font-manrope',
});

const optInter = Inter({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-inter' });

const optPlex = IBM_Plex_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-plex' });

const optLexend = Lexend({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-lexend' });

const optAtkinson = Atkinson_Hyperlegible({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-atkinson',
});

const optSourceSerif = Source_Serif_4({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-source-serif',
});

const optJetBrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-jetbrains',
});

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s | ${brand.name}` },
  description: 'Read and send mail from your own mail server.',
  // No openGraph/twitter here: they need an absolute origin, and the one image
  // is built once and served from any host, so /login (the only page worth
  // sharing) derives it from the request in its own generateMetadata.
  // A webmail is a private surface; there is nothing here for a crawler.
  robots: { index: false, follow: false },
  // The icons live in public/ only -- an app/favicon.ico or app/apple-icon.png
  // gets emitted as well and drifts from these. ?v= is the cache-buster:
  // browsers keep favicons by URL, so bump it whenever an icon is replaced.
  // v=2026b: the favicon was a 32x28 bare mark whose indigo loops vanished on
  // dark tabs; every icon is now rendered from public/icon.svg (white M on an
  // indigo tile), and the SVG is offered first so modern browsers stay crisp.
  icons: {
    icon: [
      { url: '/icon.svg?v=2026b', type: 'image/svg+xml' },
      { url: '/favicon.ico?v=2026b', sizes: '16x16 32x32 48x48' },
      { url: '/logo-192.png?v=2026b', type: 'image/png', sizes: '192x192' },
    ],
    apple: '/apple-touch-icon.png?v=2026b',
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
 * padding everywhere, which nothing here has yet. themeColor -- a media
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
      className={[
        body.variable,
        display.variable,
        mono.variable,
        // Only defines the custom properties; nothing downloads until a
        // data-font block in globals.css actually names one.
        optManrope.variable,
        optInter.variable,
        optPlex.variable,
        optLexend.variable,
        optAtkinson.variable,
        optSourceSerif.variable,
        optJetBrains.variable,
      ].join(' ')}
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
        {/* The chosen font and text size, onto <html> before the first paint
            for the same reason as the pane widths: a size applied after
            hydration would reflow every line of text on every page load. */}
        <script dangerouslySetInnerHTML={{ __html: TYPOGRAPHY_SCRIPT }} />
      </head>
      {/* Analytics runs on the sign-in page only (app/login/page.tsx): inside
          the app a recording would be people's mail (owner, 2026-10-11).
          data-clarity-mask stays on the whole body as a backstop -- if a
          recording ever reaches past sign-in, every piece of text is a grey
          block. The sign-in page unmasks only its fixed words (AuthLayout). */}
      <body suppressHydrationWarning data-clarity-mask="True">
        <ThemeProvider>
          <AccentTheme />
          <Typography />
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
