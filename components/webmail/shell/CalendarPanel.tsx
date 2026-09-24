'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import FloatingPanel from '@/components/ui/Popover';
import IconButton from '@/components/ui/IconButton';
import type { CalendarEvent } from '@/lib/webmail/calendar';
import { pickDefaultCalendar, useCalendars, useEvents } from '@/lib/webmail/query/calendarQueries';

type CalendarPanelProps = {
  open: boolean;
  onClose: () => void;
  /** Asked before a link leaves the inbox; false stays. */
  onLeave?: () => boolean;
  onUnauthorized: () => void;
};

const WEEK_OPTS = { weekStartsOn: 0 as const };
const NO_EVENTS: CalendarEvent[] = [];
const UPCOMING_DAYS = 7;

/**
 * The floating month + "upcoming" panel the sidebar's Calendar row opens.
 *
 * Real data: the default calendar's events for the next seven days, from the
 * same endpoint the calendar screen uses. The month grid marks days that
 * have something on them, and clicking a day opens the full calendar there.
 */
export default function CalendarPanel({ open, onClose, onLeave }: CalendarPanelProps) {
  // Every link here leaves the inbox; the page may want to ask first.
  const guardLeave = (e: React.MouseEvent) => {
    if (onLeave && !onLeave()) e.preventDefault();
  };

  const [anchor, setAnchor] = useState(() => new Date());

  // Which calendar to read: the default one, or the first the server lists.
  // Shared with the calendar screen, so opening either after the other is instant.
  const calendarsResult = useCalendars(open);
  const calendar = calendarsResult.data
    ? pickDefaultCalendar(calendarsResult.data)
    : calendarsResult.isError
      ? 'default'
      : null;

  // The visible month plus the upcoming window, in one request.
  const range = useMemo(() => {
    const start = startOfWeek(startOfMonth(anchor), WEEK_OPTS);
    const end = addDays(endOfWeek(endOfMonth(anchor), WEEK_OPTS), 1);
    const today = startOfDay(new Date());
    const upcomingEnd = addDays(today, UPCOMING_DAYS + 1);
    return { start: start < today ? start : today, end: end > upcomingEnd ? end : upcomingEnd };
  }, [anchor]);
  const eventsResult = useEvents(calendar, range.start, range.end, open);
  const events = eventsResult.data ?? NO_EVENTS;
  const loading = eventsResult.isFetching;
  const failed = eventsResult.isError || (calendarsResult.isError && !eventsResult.data);

  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(anchor), WEEK_OPTS);
    const last = endOfWeek(endOfMonth(anchor), WEEK_OPTS);
    return eachDayOfInterval({ start: first, end: last });
  }, [anchor]);

  const busyDays = useMemo(() => {
    const set = new Set<string>();
    for (const event of events) set.add(format(new Date(event.start), 'yyyy-MM-dd'));
    return set;
  }, [events]);

  const upcoming = useMemo(() => {
    const now = startOfDay(new Date());
    const until = addDays(now, UPCOMING_DAYS);
    return events
      .filter((e) => {
        const start = new Date(e.start);
        return start >= now && start < until;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 6);
  }, [events]);

  const dayHref = (day: Date) => `/calendar?date=${format(day, 'yyyy-MM-dd')}`;

  return (
    <FloatingPanel open={open} onClose={onClose} label="Calendar" width={300}>
      <div className="border-b border-border px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-[13.5px] font-bold">{format(anchor, 'MMMM yyyy')}</span>
          <div className="flex gap-0.5">
            <IconButton label="Previous month" size="xs" onClick={() => setAnchor((a) => subMonths(a, 1))}>
              <ChevronLeft size={12} strokeWidth={2.4} />
            </IconButton>
            <IconButton label="Next month" size="xs" onClick={() => setAnchor((a) => addMonths(a, 1))}>
              <ChevronRight size={12} strokeWidth={2.4} />
            </IconButton>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((label) => (
            <div key={label} className="py-0.5 text-[10px] font-bold text-muted-foreground">
              {label}
            </div>
          ))}
          {days.map((day) => {
            const outside = !isSameMonth(day, anchor);
            const today = isToday(day);
            const busy = busyDays.has(format(day, 'yyyy-MM-dd'));
            return (
              <Link onClick={guardLeave}
                key={day.toISOString()}
                href={dayHref(day)}
                aria-label={format(day, 'EEEE d MMMM yyyy')}
                className={[
                  'relative rounded-lg py-[5px] text-[12px] tabular-nums transition-colors',
                  today
                    ? 'bg-primary font-bold text-primary-foreground'
                    : outside
                      ? 'text-muted-foreground/40 hover:bg-muted'
                      : 'text-foreground hover:bg-muted',
                ].join(' ')}
              >
                {format(day, 'd')}
                {busy && !today && (
                  <span aria-hidden className="absolute bottom-[3px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Upcoming
        </div>
        {loading && upcoming.length === 0 ? (
          <div className="border-t border-border py-2 text-[12.5px] text-muted-foreground">Loading…</div>
        ) : failed ? (
          <div className="border-t border-border py-2 text-[12.5px] text-muted-foreground">
            The calendar could not be reached.
          </div>
        ) : upcoming.length === 0 ? (
          <div className="border-t border-border py-2 text-[12.5px] text-muted-foreground">
            Nothing in the next {UPCOMING_DAYS} days
          </div>
        ) : (
          <ul className="thin-scroll max-h-44 divide-y divide-border overflow-y-auto border-t border-border">
            {upcoming.map((event) => {
              const start = new Date(event.start);
              return (
                <li key={`${event.id}-${event.start}`}>
                  <Link onClick={guardLeave} href={dayHref(start)} className="flex items-start gap-2.5 py-2 hover:text-primary">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold">{event.summary ?? 'Untitled'}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {isSameDay(start, new Date()) ? 'Today' : format(start, 'EEE d MMM')}
                        {event.all_day ? ' · all day' : ` · ${format(start, 'HH:mm')}`}
                        {event.location ? ` · ${event.location}` : ''}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Link onClick={guardLeave}
        href="/calendar"
        className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12.5px] font-semibold text-primary hover:bg-muted"
      >
        Open calendar
        <ExternalLink size={13} />
      </Link>
    </FloatingPanel>
  );
}
