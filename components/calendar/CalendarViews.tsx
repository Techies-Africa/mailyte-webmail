'use client';

/**
 * Month, week and agenda views.
 *
 * **Every date here is formatted with date-fns, never `toLocaleString` or its
 * siblings.** A bare `toLocaleString()` crashed this app on Android devices
 * whose default locale string was malformed -- it took out Reply and the
 * security settings page, and the fix was to move the whole app to date-fns.
 * Reintroducing one here would reopen that, on a screen that is nothing but
 * dates.
 */

import { useMemo } from 'react';
import {
  addDays,
  differenceInMinutes,
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
} from 'date-fns';
import type { CalendarEvent } from '@/lib/webmail/calendar';

export type ViewMode = 'month' | 'week' | 'agenda';

type ViewProps = {
  events: CalendarEvent[];
  anchor: Date;
  onSelect: (event: CalendarEvent) => void;
  onCreateAt: (start: Date, allDay: boolean) => void;
};

// Week starts Monday. A business calendar whose week starts on Sunday puts
// the two least-used days at opposite ends of the row.
const WEEK_OPTS = { weekStartsOn: 1 as const };

const HOUR_HEIGHT = 48;
const DAY_START_HOUR = 0;

function eventStart(event: CalendarEvent): Date {
  return new Date(event.start);
}

function eventEnd(event: CalendarEvent): Date {
  // An event with no DTEND is a point in time; give it a nominal half hour so
  // it is visible in a time grid rather than a zero-height sliver.
  return event.end ? new Date(event.end) : new Date(new Date(event.start).getTime() + 30 * 60000);
}

function colourFor(event: CalendarEvent): string {
  // Deterministic per calendar so two calendars stay visually distinct
  // without the server having to supply a colour for each one.
  const palette = [
    'bg-teal-600', 'bg-indigo-600', 'bg-rose-600',
    'bg-amber-600', 'bg-sky-600', 'bg-violet-600',
  ];
  let hash = 0;
  for (const ch of event.calendar) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return eventStart(a).getTime() - eventStart(b).getTime();
}

/** Events that touch a given day, all-day events first. */
function eventsOn(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events
    .filter((event) => {
      const start = startOfDay(eventStart(event));
      const end = startOfDay(eventEnd(event));
      const target = startOfDay(day).getTime();
      return start.getTime() <= target && target <= end.getTime();
    })
    .sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return byStart(a, b);
    });
}

// ---------------------------------------------------------------------------
// Month
// ---------------------------------------------------------------------------

export function MonthView({ events, anchor, onSelect, onCreateAt }: ViewProps) {
  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(anchor), WEEK_OPTS);
    const last = endOfWeek(endOfMonth(anchor), WEEK_OPTS);
    return eachDayOfInterval({ start: first, end: last });
  }, [anchor]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-neutral-200 dark:border-neutral-800">
        {days.slice(0, 7).map((day) => (
          <div
            key={day.toISOString()}
            className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
          >
            {format(day, 'EEE')}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
        {days.map((day) => {
          const dayEvents = eventsOn(events, day);
          const outside = !isSameMonth(day, anchor);
          return (
            <div
              key={day.toISOString()}
              className={[
                'min-w-0 border-b border-r border-neutral-200 p-1 dark:border-neutral-800',
                outside ? 'bg-neutral-50/60 dark:bg-neutral-900/40' : '',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => onCreateAt(day, true)}
                className="mb-1 flex w-full items-center justify-between rounded px-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                aria-label={`Add an event on ${format(day, 'd MMMM yyyy')}`}
              >
                <span
                  className={[
                    'text-xs tabular-nums',
                    isToday(day)
                      ? 'rounded-full bg-teal-600 px-1.5 py-0.5 font-semibold text-white'
                      : outside
                        ? 'text-neutral-400 dark:text-neutral-600'
                        : 'text-neutral-700 dark:text-neutral-300',
                  ].join(' ')}
                >
                  {format(day, 'd')}
                </span>
              </button>

              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((event) => (
                  <button
                    key={`${event.id}-${event.start}`}
                    type="button"
                    onClick={() => onSelect(event)}
                    className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] text-white ${colourFor(event)}`}
                    title={event.summary ?? 'Untitled'}
                  >
                    {!event.all_day && (
                      <span className="tabular-nums opacity-80">
                        {format(eventStart(event), 'HH:mm')}
                      </span>
                    )}
                    <span className="truncate">{event.summary ?? 'Untitled'}</span>
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <div className="px-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week
// ---------------------------------------------------------------------------

export function WeekView({ events, anchor, onSelect, onCreateAt }: ViewProps) {
  const days = useMemo(() => {
    const first = startOfWeek(anchor, WEEK_OPTS);
    return eachDayOfInterval({ start: first, end: addDays(first, 6) });
  }, [anchor]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-neutral-200 dark:border-neutral-800">
        <div />
        {days.map((day) => (
          <div key={day.toISOString()} className="px-1 py-2 text-center">
            <div className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {format(day, 'EEE')}
            </div>
            <div
              className={[
                'text-sm tabular-nums',
                isToday(day) ? 'font-semibold text-teal-600 dark:text-teal-400' : '',
              ].join(' ')}
            >
              {format(day, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* All-day events get their own strip. Laying them out in the time grid
          would either give them a full-height column or hide them entirely. */}
      <div className="grid shrink-0 grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-neutral-200 dark:border-neutral-800">
        <div className="px-1 py-1 text-[10px] uppercase text-neutral-400">All day</div>
        {days.map((day) => (
          <div key={day.toISOString()} className="min-h-[1.75rem] space-y-0.5 p-0.5">
            {eventsOn(events, day)
              .filter((e) => e.all_day)
              .map((event) => (
                <button
                  key={`${event.id}-ad`}
                  type="button"
                  onClick={() => onSelect(event)}
                  className={`w-full truncate rounded px-1 text-left text-[11px] text-white ${colourFor(event)}`}
                >
                  {event.summary ?? 'Untitled'}
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          <div>
            {hours.map((hour) => (
              <div
                key={hour}
                style={{ height: HOUR_HEIGHT }}
                className="relative border-b border-neutral-100 pr-2 text-right text-[10px] tabular-nums text-neutral-400 dark:border-neutral-800/60"
              >
                <span className="absolute right-2 -top-1.5">
                  {format(new Date(2000, 0, 1, hour), 'HH:mm')}
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => (
            <div key={day.toISOString()} className="relative border-l border-neutral-200 dark:border-neutral-800">
              {hours.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  style={{ height: HOUR_HEIGHT }}
                  onClick={() => {
                    const at = new Date(day);
                    at.setHours(hour, 0, 0, 0);
                    onCreateAt(at, false);
                  }}
                  className="block w-full border-b border-neutral-100 hover:bg-teal-50/60 dark:border-neutral-800/60 dark:hover:bg-teal-900/20"
                  aria-label={`Add an event at ${format(new Date(2000, 0, 1, hour), 'HH:mm')} on ${format(day, 'd MMMM')}`}
                />
              ))}

              {eventsOn(events, day)
                .filter((e) => !e.all_day)
                .map((event) => {
                  const start = eventStart(event);
                  const end = eventEnd(event);
                  const top =
                    ((start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes()) *
                    (HOUR_HEIGHT / 60);
                  // Floor at 18px: a 10-minute event is otherwise too short to
                  // read or to click.
                  const height = Math.max(
                    18,
                    differenceInMinutes(end, start) * (HOUR_HEIGHT / 60),
                  );
                  return (
                    <button
                      key={`${event.id}-${event.start}`}
                      type="button"
                      onClick={() => onSelect(event)}
                      style={{ top, height }}
                      className={`absolute inset-x-0.5 overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight text-white ${colourFor(event)}`}
                    >
                      <div className="truncate font-medium">{event.summary ?? 'Untitled'}</div>
                      {height > 30 && (
                        <div className="truncate tabular-nums opacity-80">
                          {format(start, 'HH:mm')}–{format(end, 'HH:mm')}
                        </div>
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

export function AgendaView({ events, onSelect }: Omit<ViewProps, 'onCreateAt' | 'anchor'>) {
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of [...events].sort(byStart)) {
      const key = format(eventStart(event), 'yyyy-MM-dd');
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return [...map.entries()];
  }, [events]);

  if (grouped.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-neutral-500 dark:text-neutral-400">
        Nothing scheduled in this range.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {grouped.map(([key, dayEvents]) => {
        const day = new Date(`${key}T00:00:00`);
        return (
          <div key={key} className="border-b border-neutral-200 dark:border-neutral-800">
            <div
              className={[
                'sticky top-0 z-10 bg-white/95 px-4 py-1.5 text-xs font-medium backdrop-blur dark:bg-neutral-950/95',
                isSameDay(day, new Date())
                  ? 'text-teal-600 dark:text-teal-400'
                  : 'text-neutral-500 dark:text-neutral-400',
              ].join(' ')}
            >
              {format(day, 'EEEE d MMMM yyyy')}
            </div>
            <ul>
              {dayEvents.map((event) => (
                <li key={`${event.id}-${event.start}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(event)}
                    className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
                    <span className="w-24 shrink-0 pt-0.5 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                      {event.all_day
                        ? 'All day'
                        : `${format(eventStart(event), 'HH:mm')}–${format(eventEnd(event), 'HH:mm')}`}
                    </span>
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${colourFor(event)}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{event.summary ?? 'Untitled'}</span>
                      {event.location && (
                        <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                          {event.location}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
