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
 *
 * Events wear their calendar's own colour -- the swatch in the header's
 * picker -- passed in as `colour` and applied through `style`, so no colour
 * value lives in the source. A calendar without one uses the accent.
 */

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
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
import { CalendarDays, Clock, MapPin, Plus, Repeat, Users } from 'lucide-react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import type { CalendarEvent } from '@/lib/webmail/calendar';

export type ViewMode = 'month' | 'week' | 'agenda';

type ViewProps = {
  events: CalendarEvent[];
  anchor: Date;
  /** The calendar's own colour (calendarColour), or null for the accent. */
  colour: string | null;
  onSelect: (event: CalendarEvent) => void;
  onCreateAt: (start: Date, allDay: boolean) => void;
};

// Week starts Monday. A business calendar whose week starts on Sunday puts
// the two least-used days at opposite ends of the row.
const WEEK_OPTS = { weekStartsOn: 1 as const };

const HOUR_HEIGHT = 48;
const DAY_START_HOUR = 0;
/** Where the week's time grid opens: the working day, not midnight, which put a 9am event 430px down. */
const WEEK_SCROLL_HOUR = 7;
/** The shortest a timed block is drawn: a 10-minute event is otherwise too short to read or to click. */
const MIN_BLOCK_PX = 20;
/** The same floor in minutes, so two short events drawn touching are laid out side by side. */
const MIN_BLOCK_MINUTES = Math.ceil(MIN_BLOCK_PX / (HOUR_HEIGHT / 60));

/** Events a month cell lists before its row has been measured; after that, as many as fit. */
const MONTH_VISIBLE = 3;
/** A month row's floor (5.5rem): the date, one event and "+N more". */
const MONTH_ROW_MIN = 88;
/**
 * Per month row: padding, border, the date, the gaps and "+N more". The last
 * 4px may sit in the cell's bottom padding, which overflow-hidden does not clip.
 */
const MONTH_ROW_CHROME = 50;
/** One event row in a month cell, with its 1px gap. */
const MONTH_EVENT_ROW = 21;

function eventStart(event: CalendarEvent): Date {
  return new Date(event.start);
}

function eventEnd(event: CalendarEvent): Date {
  // An event with no DTEND is a point in time; give it a nominal half hour so
  // it is visible in a time grid rather than a zero-height sliver.
  return event.end ? new Date(event.end) : new Date(new Date(event.start).getTime() + 30 * 60000);
}

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return eventStart(a).getTime() - eventStart(b).getTime();
}

/**
 * Events that touch a given day, all-day events first.
 *
 * A timed event that ends exactly at midnight belongs to the day before:
 * counted to the millisecond, 23:00-00:00 also showed on the next day. An
 * all-day event's end is left alone -- it sits on the event's last day.
 */
function eventsOn(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const target = startOfDay(day).getTime();
  return events
    .filter((event) => {
      const start = eventStart(event);
      const end = eventEnd(event);
      const last = !event.all_day && end > start ? new Date(end.getTime() - 1) : end;
      return startOfDay(start).getTime() <= target && target <= startOfDay(last).getTime();
    })
    .sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return byStart(a, b);
    });
}

/** Whether an event is over: a timed one once it has ended, an all-day one once its last day has. */
function isOver(event: CalendarEvent, now: Date): boolean {
  if (event.all_day) return startOfDay(eventEnd(event)) < startOfDay(now);
  return eventEnd(event) <= now;
}

/**
 * Minutes since midnight by the clock, the way the hour rows are drawn, with
 * the next midnight as 1440. Not elapsed time: on the day the clocks change,
 * elapsed minutes put every later event an hour off its row.
 */
function clockMinutes(date: Date, day: Date): number {
  return date >= addDays(startOfDay(day), 1) ? 1440 : date.getHours() * 60 + date.getMinutes();
}

/** The time now, moved on each minute: the week's "now" line, and which agenda rows are over. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

type Paint = { className: string; style?: React.CSSProperties };

/**
 * WCAG relative luminance of a 3, 4, 6 or 8 digit hex colour -- the shapes
 * calendarColour lets through. Alpha is ignored.
 */
function luminance(hex: string): number {
  const raw = hex.slice(1);
  const digits = raw.length <= 4 ? [...raw.slice(0, 3)].map((d) => d + d).join('') : raw.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(digits.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * A filled chip or block in the calendar's colour, with a label that stays
 * readable on it: ink on a light colour (Apple's default blue, an orange, a
 * yellow), white on the rest. No colour: the accent, whose label the theme
 * already knows.
 */
function fillFor(colour: string | null): Paint {
  if (!colour) return { className: 'bg-primary text-primary-foreground' };
  const label = luminance(colour) > 0.3 ? 'text-zinc-900' : 'text-white';
  return { className: label, style: { backgroundColor: colour } };
}

/** A dot or a bar in the calendar's colour. */
function dotFor(colour: string | null): Paint {
  if (!colour) return { className: 'bg-primary' };
  return { className: '', style: { backgroundColor: colour } };
}

// ---------------------------------------------------------------------------
// Event chips
// ---------------------------------------------------------------------------

type ChipProps = { event: CalendarEvent; colour: string | null; onClick: () => void };

/** An all-day event: a bar filled with the calendar's colour. */
function AllDayChip({ event, colour, onClick }: ChipProps) {
  const fill = fillFor(colour);
  const title = event.summary ?? 'Untitled';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={fill.style}
      className={[
        'flex w-full min-w-0 shrink-0 items-center rounded px-1.5 py-0.5 text-left text-[11px] font-semibold leading-4 transition-[filter] hover:brightness-95 sm:text-xs',
        fill.className,
      ].join(' ')}
    >
      <span className="truncate">{title}</span>
    </button>
  );
}

/**
 * A timed event in a month cell, the way Google draws one: a dot in the
 * calendar's colour, the time and the title, on no fill. Filled chips for
 * every event turned a busy week into a wall of colour.
 */
function MonthTimedRow({ event, colour, onClick }: ChipProps) {
  const dot = dotFor(colour);
  const title = event.summary ?? 'Untitled';
  const time = format(eventStart(event), 'HH:mm');
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${time} ${title}`}
      className="flex w-full min-w-0 shrink-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] leading-4 text-foreground transition-colors hover:bg-muted sm:text-xs"
    >
      <span aria-hidden className={['h-2 w-2 shrink-0 rounded-full', dot.className].join(' ')} style={dot.style} />
      {/* No time on a phone: in a 50px day it filled the row and the title never showed. */}
      <span className="hidden shrink-0 tabular-nums text-muted-foreground sm:inline">{time}</span>
      <span className="min-w-0 truncate font-medium">{title}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Month
// ---------------------------------------------------------------------------

export function MonthView({ events, anchor, colour, onSelect, onCreateAt }: ViewProps) {
  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(anchor), WEEK_OPTS);
    const last = endOfWeek(endOfMonth(anchor), WEEK_OPTS);
    return eachDayOfInterval({ start: first, end: last });
  }, [anchor]);
  const weeks = days.length / 7;
  /** The day whose "+N more" was pressed: its whole list opens in a dialog. */
  const [moreDay, setMoreDay] = useState<Date | null>(null);

  // As many events per cell as its row has room for, as Google does. A fixed
  // three needed rows so tall that every month scrolled on a laptop screen.
  const gridRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(MONTH_VISIBLE);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const fit = () => {
      const row = Math.max(MONTH_ROW_MIN, grid.clientHeight / weeks);
      setVisible(Math.max(1, Math.floor((row - MONTH_ROW_CHROME) / MONTH_EVENT_ROW)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [weeks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {days.slice(0, 7).map((day) => (
          <div
            key={day.toISOString()}
            className="py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-[11px]"
          >
            {format(day, 'EEE')}
          </div>
        ))}
      </div>

      {/* Rows share the height, but never below 5.5rem: on a short screen (a
          phone in landscape) the weeks scroll rather than squeeze. */}
      <div
        ref={gridRef}
        className="thin-scroll grid min-h-0 flex-1 auto-rows-[minmax(5.5rem,1fr)] grid-cols-7 overflow-y-auto"
      >
        {days.map((day) => {
          const dayEvents = eventsOn(events, day);
          const outside = !isSameMonth(day, anchor);
          const today = isToday(day);
          const hidden = dayEvents.length - visible;
          return (
            <div
              key={day.toISOString()}
              className={[
                'flex min-w-0 flex-col gap-px overflow-hidden border-b border-r border-border p-1',
                outside ? 'bg-pane' : '',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => onCreateAt(day, true)}
                aria-label={`Add an event on ${format(day, 'd MMMM yyyy')}`}
                className="group mb-0.5 flex w-full shrink-0 justify-center rounded-md"
              >
                <span
                  className={[
                    'inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums transition-colors',
                    today
                      ? 'bg-primary text-primary-foreground'
                      : outside
                        ? 'text-muted-foreground/70 group-hover:bg-muted'
                        : 'text-foreground group-hover:bg-muted',
                  ].join(' ')}
                >
                  {day.getDate() === 1 ? format(day, 'd MMM') : format(day, 'd')}
                </span>
              </button>

              {dayEvents.slice(0, visible).map((event) =>
                event.all_day ? (
                  <AllDayChip key={`${event.id}-${event.start}`} event={event} colour={colour} onClick={() => onSelect(event)} />
                ) : (
                  <MonthTimedRow key={`${event.id}-${event.start}`} event={event} colour={colour} onClick={() => onSelect(event)} />
                ),
              )}

              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setMoreDay(day)}
                  className="shrink-0 self-start rounded px-1 py-px text-[11px] font-semibold leading-4 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  +{hidden} more
                </button>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={moreDay !== null} onClose={() => setMoreDay(null)} title={moreDay ? format(moreDay, 'EEEE d MMMM') : ''} width="sm">
        {moreDay && (
          <ul className="-mx-2 space-y-0.5">
            {eventsOn(events, moreDay).map((event) => (
              <AgendaRow
                key={`${event.id}-${event.start}`}
                event={event}
                colour={colour}
                over={false}
                onSelect={(picked) => {
                  setMoreDay(null);
                  onSelect(picked);
                }}
              />
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week
// ---------------------------------------------------------------------------

type Placed = { event: CalendarEvent; start: Date; end: Date; column: number; columns: number };

/**
 * One day's timed events, clipped to the day and laid out side by side where
 * they overlap -- the way every calendar people already use draws a clash --
 * instead of the later block covering the earlier. Each run of overlapping
 * events shares a column count; one that starts as another ends does not
 * overlap it.
 */
function layoutDay(events: CalendarEvent[], day: Date): Placed[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const items = events
    .map((event) => {
      const start = eventStart(event);
      const end = eventEnd(event);
      return { event, start: start < dayStart ? dayStart : start, end: end > dayEnd ? dayEnd : end };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());

  const placed: Placed[] = [];
  let run: Placed[] = [];
  let columnEnds: number[] = [];
  let runEnd = 0;

  const closeRun = () => {
    for (const item of run) item.columns = columnEnds.length;
    placed.push(...run);
    run = [];
    columnEnds = [];
  };

  for (const item of items) {
    const from = item.start.getTime();
    const to = Math.max(item.end.getTime(), from + MIN_BLOCK_MINUTES * 60000);
    if (run.length > 0 && from >= runEnd) closeRun();
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= from);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(to);
    } else {
      columnEnds[column] = to;
    }
    run.push({ ...item, column, columns: 1 });
    runEnd = run.length === 1 ? to : Math.max(runEnd, to);
  }
  closeRun();
  return placed;
}

export function WeekView({ events, anchor, colour, onSelect, onCreateAt }: ViewProps) {
  const days = useMemo(() => {
    const first = startOfWeek(anchor, WEEK_OPTS);
    return eachDayOfInterval({ start: first, end: addDays(first, 6) });
  }, [anchor]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const now = useNow();
  const nowTop = (now.getHours() * 60 + now.getMinutes()) * (HOUR_HEIGHT / 60);
  const fill = fillFor(colour);

  // Open on the working day. Once, on arrival: moving between weeks keeps
  // wherever the reader has scrolled to.
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = (WEEK_SCROLL_HOUR - DAY_START_HOUR) * HOUR_HEIGHT;
  }, []);

  return (
    // Seven columns never narrower than about 65px: on a phone the week pans
    // sideways instead of giving each day 43px and three letters of a title.
    <div className="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden">
      <div className="flex min-h-0 min-w-[32rem] flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border">
          <div className="flex items-end justify-end pb-2 pr-2 text-[10px] font-medium text-muted-foreground">
            {format(days[0], 'O')}
          </div>
          {days.map((day) => {
            const today = isToday(day);
            return (
              <div key={day.toISOString()} className="flex flex-col items-center gap-0.5 py-2">
                <span
                  className={[
                    'text-[11px] font-semibold uppercase tracking-wider',
                    today ? 'text-primary' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {format(day, 'EEE')}
                </span>
                <span
                  className={[
                    'flex h-9 w-9 items-center justify-center rounded-full font-display text-lg font-semibold tabular-nums sm:h-10 sm:w-10 sm:text-[22px]',
                    today ? 'bg-primary text-primary-foreground' : 'text-foreground',
                  ].join(' ')}
                >
                  {format(day, 'd')}
                </span>
              </div>
            );
          })}
        </div>

        {/* All-day events get their own strip. Laying them out in the time grid
            would either give them a full-height column or hide them entirely. */}
        <div className="grid shrink-0 grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border">
          <div className="flex items-center justify-end pr-2 text-[10px] font-medium text-muted-foreground">All day</div>
          {days.map((day) => (
            <div key={day.toISOString()} className="min-h-[1.75rem] min-w-0 space-y-0.5 border-l border-border p-0.5">
              {eventsOn(events, day)
                .filter((e) => e.all_day)
                .map((event) => (
                  <AllDayChip key={`${event.id}-${event.start}`} event={event} colour={colour} onClick={() => onSelect(event)} />
                ))}
            </div>
          ))}
        </div>

        <div ref={gridRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
            <div>
              {hours.map((hour) => (
                <div key={hour} style={{ height: HOUR_HEIGHT }} className="relative pr-2 text-right text-[10px] tabular-nums text-muted-foreground">
                  {/* Midnight has no label: at the very top it would be cut in half. */}
                  {hour > 0 && (
                    <span className="absolute -top-[7px] right-2">{format(new Date(2000, 0, 1, hour), 'HH:mm')}</span>
                  )}
                </div>
              ))}
            </div>

            {days.map((day) => (
              <div key={day.toISOString()} className="relative border-l border-border">
                {hours.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    style={{ height: HOUR_HEIGHT }}
                    onClick={(e) => {
                      // The half of the hour that was clicked: the lower half starts at :30.
                      const rect = e.currentTarget.getBoundingClientRect();
                      const lowerHalf = e.clientY - rect.top >= rect.height / 2;
                      const at = new Date(day);
                      at.setHours(hour, lowerHalf ? 30 : 0, 0, 0);
                      onCreateAt(at, false);
                    }}
                    className="block w-full border-b border-border/60 transition-colors hover:bg-muted/60"
                    aria-label={`Add an event at ${format(new Date(2000, 0, 1, hour), 'HH:mm')} on ${format(day, 'd MMMM')}`}
                  />
                ))}

                {layoutDay(
                  eventsOn(events, day).filter((e) => !e.all_day),
                  day,
                ).map(({ event, start, end, column, columns }) => {
                  const from = clockMinutes(start, day);
                  const top = from * (HOUR_HEIGHT / 60);
                  const height = Math.max(MIN_BLOCK_PX, (clockMinutes(end, day) - from) * (HOUR_HEIGHT / 60));
                  const share = 100 / columns;
                  const title = event.summary ?? 'Untitled';
                  const time = `${format(eventStart(event), 'HH:mm')} – ${format(eventEnd(event), 'HH:mm')}`;
                  return (
                    <button
                      key={`${event.id}-${event.start}`}
                      type="button"
                      onClick={() => onSelect(event)}
                      title={`${title}\n${time}`}
                      style={{
                        top,
                        height,
                        left: `calc(${column * share}% + 2px)`,
                        width: `calc(${share}% - 4px)`,
                        ...fill.style,
                      }}
                      className={[
                        'absolute z-10 flex flex-col overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm ring-1 ring-card transition-[filter] hover:brightness-95',
                        fill.className,
                      ].join(' ')}
                    >
                      <span className="truncate font-semibold">{title}</span>
                      {height >= 34 && <span className="truncate tabular-nums opacity-90">{time}</span>}
                      {height >= 56 && event.location && <span className="truncate opacity-90">{event.location}</span>}
                    </button>
                  );
                })}

                {isToday(day) && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive" style={{ top: nowTop }}>
                    <span className="absolute -left-[5px] -top-1 h-2.5 w-2.5 rounded-full bg-destructive" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

/** When an event is on, in the agenda's words: "All day", "09:30 – 10:00", or across days. */
function agendaTime(event: CalendarEvent): string {
  const start = eventStart(event);
  const end = eventEnd(event);
  if (event.all_day) return isSameDay(start, end) ? 'All day' : `All day · until ${format(end, 'EEE d MMM')}`;
  if (isSameDay(start, end)) return `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')}`;
  return `${format(start, 'HH:mm')} – ${format(end, 'EEE d MMM, HH:mm')}`;
}

/** One event in the agenda (and in a month day's "+N more" list). */
function AgendaRow({
  event,
  colour,
  over,
  onSelect,
}: {
  event: CalendarEvent;
  colour: string | null;
  /** Already over: drawn faded, as Google's schedule does. */
  over: boolean;
  onSelect: (event: CalendarEvent) => void;
}) {
  const bar = dotFor(colour);
  const guests = event.attendees.length;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(event)}
        className={[
          'flex w-full items-stretch gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted',
          over ? 'opacity-60' : '',
        ].join(' ')}
      >
        <span aria-hidden className={['w-1 shrink-0 rounded-full', bar.className].join(' ')} style={bar.style} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{event.summary ?? 'Untitled'}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock size={12} aria-hidden />
              {agendaTime(event)}
            </span>
            {event.location && (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                <MapPin size={12} aria-hidden className="shrink-0" />
                <span className="truncate">{event.location}</span>
              </span>
            )}
            {guests > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users size={12} aria-hidden />
                {guests} {guests === 1 ? 'guest' : 'guests'}
              </span>
            )}
            {event.recurring && (
              <span className="inline-flex items-center gap-1">
                <Repeat size={12} aria-hidden />
                Repeats
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

type AgendaProps = {
  events: CalendarEvent[];
  colour: string | null;
  onSelect: (event: CalendarEvent) => void;
  /** Absent on a read-only calendar: the empty state then offers nothing to create. */
  onCreate?: () => void;
};

/**
 * The schedule: a centred column of days, a month heading where the month
 * turns, each day's weekday and number beside its events. It was a full-width
 * list of grey date bars, with the times pinned to the far left of a wide
 * screen and nothing at all to the right of the titles.
 */
export function AgendaView({ events, colour, onSelect, onCreate }: AgendaProps) {
  const now = useNow();
  const groups = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of [...events].sort(byStart)) {
      const key = format(eventStart(event), 'yyyy-MM-dd');
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return [...map.entries()];
  }, [events]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CalendarDays size={22} aria-hidden />
        </span>
        <p className="font-display text-[15px] font-semibold text-foreground">Nothing scheduled</p>
        <p className="max-w-xs text-sm text-muted-foreground">There are no events in this period.</p>
        {onCreate && (
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={onCreate} className="mt-2">
            New event
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-3 pb-10 sm:px-6">
        {groups.map(([key, dayEvents], index) => {
          const day = new Date(`${key}T00:00:00`);
          const newMonth = index === 0 || !isSameMonth(day, new Date(`${groups[index - 1][0]}T00:00:00`));
          const today = isToday(day);
          return (
            <Fragment key={key}>
              {newMonth && (
                <h2 className="px-1 pb-2 pt-6 font-display text-[15px] font-semibold tracking-tight text-foreground">
                  {format(day, 'MMMM yyyy')}
                </h2>
              )}
              <section aria-label={format(day, 'EEEE d MMMM yyyy')} className="flex gap-3 border-t border-border py-2 sm:gap-5">
                <div className="flex w-12 shrink-0 flex-col items-center pt-2 sm:w-14">
                  <span
                    className={[
                      'text-[11px] font-semibold uppercase tracking-wider',
                      today ? 'text-primary' : 'text-muted-foreground',
                    ].join(' ')}
                  >
                    {format(day, 'EEE')}
                  </span>
                  <span
                    className={[
                      'mt-1 flex h-10 w-10 items-center justify-center rounded-full font-display text-xl font-semibold tabular-nums',
                      today ? 'bg-primary text-primary-foreground' : 'text-foreground',
                    ].join(' ')}
                  >
                    {format(day, 'd')}
                  </span>
                </div>
                <ul className="min-w-0 flex-1 space-y-0.5">
                  {dayEvents.map((event) => (
                    <AgendaRow
                      key={`${event.id}-${event.start}`}
                      event={event}
                      colour={colour}
                      over={isOver(event, now)}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              </section>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
