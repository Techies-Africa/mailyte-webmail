'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { makeQueryClient } from '@/lib/webmail/query/queryClient';
import { ACCOUNT_MISMATCH_EVENT } from '@/lib/webmail/client';
import { qk } from '@/lib/webmail/query/keys';
import { abortSessionChange, dropAllHeld, flushHeldOnExit, settleAllHeld } from '@/lib/webmail/query/opRunner';
import { clearUnauthorizedRedirect, onAccountChange, setSessionSettler } from '@/lib/webmail/query/session';

/** How long after coming back the folders are checked a second time. */
const RETURN_RECHECK_MS = 8_000;

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

  // Back in the window. TanStack Query hears only `visibilitychange`, which
  // stays silent when someone returns from another app and this window never
  // left the screen, so the window's own focus counts too. `onFocus()` takes
  // no argument: the answer stays "is the tab visible", which is what keeps
  // the folder poll paused in a hidden tab.
  useEffect(() => {
    let recheck: number | undefined;
    focusManager.setEventListener((onFocus) => {
      // Clicking into the message frame blurs this window while the page
      // keeps focus, and the click back out fires `focus` again: not a return.
      let withinPage = false;
      const onBlur = () => {
        window.setTimeout(() => {
          withinPage = document.hasFocus();
        }, 0);
      };
      const onReturn = (event: Event) => {
        if (event.type === 'focus' && withinPage) {
          withinPage = false;
          return;
        }
        onFocus();
        // A code someone came here to fetch often lands a few seconds after they do.
        window.clearTimeout(recheck);
        if (document.visibilityState === 'visible') {
          recheck = window.setTimeout(
            () => void client.refetchQueries({ queryKey: qk.folders, exact: true, type: 'active' }),
            RETURN_RECHECK_MS,
          );
        }
      };
      window.addEventListener('visibilitychange', onReturn);
      window.addEventListener('focus', onReturn);
      window.addEventListener('blur', onBlur);
      return () => {
        window.clearTimeout(recheck);
        window.removeEventListener('visibilitychange', onReturn);
        window.removeEventListener('focus', onReturn);
        window.removeEventListener('blur', onBlur);
      };
    });
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
