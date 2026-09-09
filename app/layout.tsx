import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import AccentTheme from '@/components/providers/AccentTheme';
import { brand } from '@/lib/webmail/brand';

export const metadata: Metadata = {
  title: brand.name,
  description: 'Read and send mail from your own mail server.',
  // A webmail is a private surface; there is nothing here for a crawler.
  robots: { index: false, follow: false },
  // Below 32px the wing detail closes up, so the .ico carries a dart-only cut
  // at 16 and 32 and the full lockup at 48 — a tab icon has to survive being
  // a tab icon.
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
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <AccentTheme />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

