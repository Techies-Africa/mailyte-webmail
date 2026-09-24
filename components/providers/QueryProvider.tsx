'use client';

import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { makeQueryClient } from '@/lib/webmail/query/queryClient';
import { onAccountChange } from '@/lib/webmail/query/session';

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

  // Another tab signed in, switched mailbox or signed out: whatever this tab
  // holds belongs to the previous account. Forget it and start over.
  useEffect(
    () =>
      onAccountChange(() => {
        client.clear();
        // The sign-in screens hold no mail, and are mid-way through a session change of their own.
        if (window.location.pathname === '/login' || window.location.pathname === '/change-password') return;
        window.location.assign('/');
      }),
    [client],
  );

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
