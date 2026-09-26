'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { makeQueryClient } from '@/lib/webmail/query/queryClient';
import { ACCOUNT_MISMATCH_EVENT } from '@/lib/webmail/client';
import { qk } from '@/lib/webmail/query/keys';
import { abortSessionChange, dropAllHeld, flushHeldOnExit, settleAllHeld } from '@/lib/webmail/query/opRunner';
import { clearUnauthorizedRedirect, onAccountChange, setSessionSettler } from '@/lib/webmail/query/session';

/**
 * The query cache for the whole app.
 *
 * Created in state rather than at module level, so a server render never
 * shares a client between requests. Mounted in the root layout, so it
 * survives client-side navigation between Mail, Calendar, Contacts and
 * Settings -- which is the point of it.
 */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);

  // Arriving anywhere but sign-in means a redirect to it is no longer under way.
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== '/login') clearUnauthorizedRedirect();
  }, [pathname]);

  // Another tab signed in, switched mailbox or signed out: whatever this tab
  // holds belongs to the previous account. Forget it and start over.
  useEffect(
    () =>
      onAccountChange(() => {
        // The cookie is already someone else's: held actions must not go to their mailbox.
        dropAllHeld(client);
        client.clear();
        // The sign-in screens hold no mail, and are mid-way through a session change of their own.
        if (window.location.pathname === '/login' || window.location.pathname === '/change-password') return;
        window.location.assign('/');
      }),
    [client],
  );

  // Switching or signing out from this tab: send held actions first, while
  // their ids still belong to this mailbox.
  useEffect(() => {
    setSessionSettler({ settle: () => settleAllHeld(client), abort: () => abortSessionChange(client) });
    return () => setSessionSettler(null);
  }, [client]);

  // A request was refused as meant for another mailbox: ask the server whose
  // this is now. The capabilities query notices the change and starts over.
  useEffect(() => {
    const onMismatch = () => void client.refetchQueries({ queryKey: qk.capabilities, type: 'all' });
    window.addEventListener(ACCOUNT_MISMATCH_EVENT, onMismatch);
    return () => window.removeEventListener(ACCOUNT_MISMATCH_EVENT, onMismatch);
  }, [client]);

  // Removals waiting out their Undo window still happen if the page goes away.
  useEffect(() => {
    const onPageHide = () => flushHeldOnExit(client);
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [client]);

  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        // Bottom-left, clear of the bottom-centre toast.
        <ReactQueryDevtools buttonPosition="bottom-left" />
      )}
    </QueryClientProvider>
  );
}
