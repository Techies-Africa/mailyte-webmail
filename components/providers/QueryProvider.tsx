'use client';

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { makeQueryClient } from '@/lib/webmail/query/queryClient';

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
