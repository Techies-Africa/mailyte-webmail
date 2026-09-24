'use client';

import { keepPreviousData, queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';
import {
  listCalendars,
  listEvents,
  listInvitations,
  listRooms,
  type CalendarEvent,
  type CalendarSummary,
} from '@/lib/webmail/calendar';
import { unwrap } from './errors';
import { useUnauthorizedHandler } from './session';

/**
 * The calendar's data, shared by the calendar screen, the inbox's calendar
 * panel and the event dialog. A month seen once is kept, so moving back and
 * forth between months -- or leaving the calendar and coming back -- does not
 * load it again.
 */

export const calendarKeys = {
  all: ['mb', 'cal'] as const,
  calendars: ['mb', 'cal', 'calendars'] as const,
  /** Prefix of every range of events. */
  events: ['mb', 'cal', 'events'] as const,
  range: (calendar: string, start: string, end: string) => ['mb', 'cal', 'events', calendar, start, end] as const,
  invitations: ['mb', 'cal', 'invitations'] as const,
  rooms: ['mb', 'cal', 'rooms'] as const,
};

/**
 * The calendar to show first: the one this person last picked, if the server
 * still lists it; else the server's default, else the first it lists. A
 * remembered calendar that has since gone (unshared, deleted) falls back
 * rather than asking for events from nowhere.
 */
export function pickDefaultCalendar(calendars: CalendarSummary[] | undefined, preferred?: string | null): string | null {
  if (!calendars) return null;
  if (preferred && calendars.some((c) => c.uri === preferred)) return preferred;
  return (calendars.find((c) => c.is_default) ?? calendars[0])?.uri ?? 'default';
}

export function useCalendars(enabled: boolean) {
  const onUnauthorized = useUnauthorizedHandler();
  return useQuery({
    queryKey: calendarKeys.calendars,
    queryFn: async () => unwrap(await listCalendars(onUnauthorized)) ?? [],
    staleTime: 10 * 60_000,
    enabled,
  });
}

export function eventsQuery(calendar: string, start: Date, end: Date, onUnauthorized: () => void) {
  return queryOptions({
    queryKey: calendarKeys.range(calendar, start.toISOString(), end.toISOString()),
    queryFn: async (): Promise<CalendarEvent[]> => unwrap(await listEvents(calendar, start, end, onUnauthorized)) ?? [],
    staleTime: 60_000,
  });
}

/**
 * Events in a range. Moving to a range not seen yet keeps the last one on
 * screen, dimmed, until it lands -- the grid never blanks.
 */
export function useEvents(calendar: string | null, start: Date, end: Date, enabled = true) {
  const onUnauthorized = useUnauthorizedHandler();
  return useQuery({
    ...eventsQuery(calendar ?? '', start, end, onUnauthorized),
    placeholderData: keepPreviousData,
    enabled: enabled && calendar !== null,
  });
}

export function prefetchEvents(
  queryClient: QueryClient,
  calendar: string,
  start: Date,
  end: Date,
  onUnauthorized: () => void,
): void {
  void queryClient.prefetchQuery(eventsQuery(calendar, start, end, onUnauthorized));
}

export function useInvitations(enabled: boolean) {
  const onUnauthorized = useUnauthorizedHandler();
  return useQuery({
    queryKey: calendarKeys.invitations,
    queryFn: async () => unwrap(await listInvitations(onUnauthorized)) ?? [],
    staleTime: 60_000,
    enabled,
  });
}

/** Bookable rooms. Most organizations have none, and that is a normal answer. */
export function useRooms() {
  const onUnauthorized = useUnauthorizedHandler();
  return useQuery({
    queryKey: calendarKeys.rooms,
    queryFn: async () => unwrap(await listRooms(onUnauthorized)) ?? [],
    staleTime: 60 * 60_000,
    retry: false,
  });
}
