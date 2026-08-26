'use client';

import { ThemeProvider as NextThemeProvider } from 'next-themes';

/**
 * The only provider this app needs.
 *
 * The application this was extracted from wrapped its pages in session,
 * toast, sound and capability providers as well. None of them are here
 * because nothing in the webmail imports them -- a mailbox holder is not
 * signed in to an admin session, and carrying that machinery across would
 * have meant carrying next-auth into a repo whose entire point is that it
 * does not need one.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemeProvider>
  );
}
