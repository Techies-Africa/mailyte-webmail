import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors';

/**
 * Retry what might succeed next time -- a dropped connection, a 5xx -- and
 * nothing else. A 4xx or a 501 ("this server has no calendar") will say the
 * same thing again, and retrying a 401 would only delay the redirect.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status >= 400 && error.status < 500) return false;
    if (error.status === 501) return false;
  }
  return failureCount < 2;
}

/**
 * One client per browser tab, created by QueryProvider.
 *
 * The cache lives in memory only and is never persisted: it holds mail, a
 * browser can be shared, and several mailboxes can be signed in on it. Every
 * account switch and sign-out is already a full reload, which is what empties
 * it between accounts.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Revisits paint from cache and revalidate quietly once this passes.
        staleTime: 30_000,
        // How long a view nobody is looking at keeps its data.
        gcTime: 30 * 60_000,
        // Off by default; the folder poll turns it back on for itself.
        refetchOnWindowFocus: false,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        // A write is never repeated behind the user's back.
        retry: 0,
      },
    },
  });
}
