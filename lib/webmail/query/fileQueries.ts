'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { listFiles, type FileKind } from '@/lib/webmail/client';
import { unwrap } from './errors';
import { useUnauthorizedHandler } from './session';

/**
 * The Files library, page by page. Each search and each type filter is its
 * own cache entry, so going back to "All" after a search shows it at once.
 */

export const fileKeys = {
  all: ['mb', 'files'] as const,
  list: (q: string, kind: FileKind | null) => ['mb', 'files', q, kind ?? 'all'] as const,
};

export function useFiles(q: string, kind: FileKind | null) {
  const onUnauthorized = useUnauthorizedHandler();
  return useInfiniteQuery({
    queryKey: fileKeys.list(q, kind),
    queryFn: async ({ pageParam }) => unwrap(await listFiles({ q, kind, cursor: pageParam }, onUnauthorized)),
    initialPageParam: 0,
    getNextPageParam: (last) => last?.next_cursor ?? undefined,
    staleTime: 2 * 60_000,
  });
}
