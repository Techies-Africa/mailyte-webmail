'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getFilesSummary, listFiles, type FileFilters } from '@/lib/webmail/client';
import { unwrap } from './errors';
import { useUnauthorizedHandler } from './session';

/**
 * The Files library, page by page, and its overview. Each combination of
 * filters and sort is its own cache entry, so stepping back to one seen
 * before shows it at once.
 */

export const fileKeys = {
  all: ['mb', 'files'] as const,
  list: (filters: FileFilters) => ['mb', 'files', 'list', filters] as const,
  summary: ['mb', 'files', 'summary'] as const,
};

export function useFiles(filters: FileFilters) {
  const onUnauthorized = useUnauthorizedHandler();
  return useInfiniteQuery({
    queryKey: fileKeys.list(filters),
    queryFn: async ({ pageParam }) => unwrap(await listFiles({ ...filters, cursor: pageParam }, onUnauthorized)),
    initialPageParam: 0,
    getNextPageParam: (last) => last?.next_cursor ?? undefined,
    staleTime: 2 * 60_000,
    // A new filter keeps the old list on screen, dimmed, until its answer
    // arrives -- rather than blanking the page on every click.
    placeholderData: keepPreviousData,
  });
}

export function useFilesSummary(enabled = true) {
  const onUnauthorized = useUnauthorizedHandler();
  return useQuery({
    queryKey: fileKeys.summary,
    queryFn: async () => unwrap(await getFilesSummary(onUnauthorized)),
    staleTime: 5 * 60_000,
    enabled,
  });
}
