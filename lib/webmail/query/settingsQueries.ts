'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getBlockedSenders,
  getForwarding,
  getRules,
  getSecurity,
  getVacation,
  listSessions,
} from '@/lib/webmail/client';
import { listSubscriptions } from '@/lib/webmail/calendar';
import { ApiError, unwrap } from './errors';

/**
 * Each settings section's own data, cached, so a section visited before opens
 * with its values already in place instead of "Loading…".
 *
 * Settings change only when the person changes them here, so none of these
 * refetch on focus: a form half-edited in one tab is not reset by coming
 * back to it.
 */

export const settingsKeys = {
  blocked: ['mb', 'blocked'] as const,
  forwarding: ['mb', 'forwarding'] as const,
  vacation: ['mb', 'vacation'] as const,
  rules: ['mb', 'rules'] as const,
  security: ['mb', 'security'] as const,
  sessions: ['mb', 'security', 'sessions'] as const,
  subscriptions: ['mb', 'cal', 'subscriptions'] as const,
};

const SECTION_STALE = 5 * 60_000;

function required<T>(data: T | null, what: string): T {
  if (data === null || data === undefined) throw new ApiError(`${what} could not be loaded.`);
  return data;
}

export function useBlockedSenders(onUnauthorized: () => void) {
  return useQuery({
    queryKey: settingsKeys.blocked,
    queryFn: async () => required(unwrap(await getBlockedSenders(onUnauthorized)), 'Blocked senders'),
    staleTime: SECTION_STALE,
  });
}

export function useForwarding(onUnauthorized: () => void) {
  return useQuery({
    queryKey: settingsKeys.forwarding,
    queryFn: async () => required(unwrap(await getForwarding(onUnauthorized)), 'Forwarding'),
    staleTime: SECTION_STALE,
  });
}

export function useVacation(onUnauthorized: () => void) {
  return useQuery({
    queryKey: settingsKeys.vacation,
    queryFn: async () => required(unwrap(await getVacation(onUnauthorized)), 'The vacation responder'),
    staleTime: SECTION_STALE,
  });
}

export function useRules(onUnauthorized: () => void) {
  return useQuery({
    queryKey: settingsKeys.rules,
    queryFn: async () => required(unwrap(await getRules(onUnauthorized)), 'Rules'),
    staleTime: SECTION_STALE,
  });
}

export function useSecurity(onUnauthorized: () => void) {
  return useQuery({
    queryKey: settingsKeys.security,
    queryFn: async () => required(unwrap(await getSecurity(onUnauthorized)), 'Security settings'),
    staleTime: 60_000,
  });
}

export function useSessions(onUnauthorized: () => void) {
  return useQuery({
    queryKey: settingsKeys.sessions,
    queryFn: async () => unwrap(await listSessions(onUnauthorized))?.sessions ?? [],
    staleTime: 60_000,
  });
}

export function useSubscriptions(onUnauthorized: () => void) {
  return useQuery({
    queryKey: settingsKeys.subscriptions,
    queryFn: async () => unwrap(await listSubscriptions(onUnauthorized)) ?? [],
    staleTime: SECTION_STALE,
  });
}

/**
 * Fill a form from `data` the first time it is there, and never again.
 *
 * Done during render rather than in an effect, so a section whose data is
 * already cached paints with its values on the first frame -- no "Loading",
 * no flash of defaults. Never again, because a background refresh must not
 * throw away what the person is in the middle of typing. Returns whether the
 * form has been filled.
 */
export function useSeedOnce<T>(data: T | undefined, seed: (data: T) => void): boolean {
  const [seeded, setSeeded] = useState(false);
  if (data !== undefined && !seeded) {
    setSeeded(true);
    seed(data);
  }
  return seeded;
}
