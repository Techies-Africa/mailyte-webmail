import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { brand } from '@/lib/webmail/brand';

export const metadata: Metadata = {
  title: brand.name,
  description: 'Read and send mail from your own mail server.',
  // A webmail is a private surface; there is nothing here for a crawler.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes sets the class on <html> before
    // React hydrates, which is the intended behaviour and would otherwise be
    // reported as a mismatch on every page load.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

