// The times "Schedule send" offers, and the conversions between a Date and
// what an <input type="datetime-local"> holds.
//
// Pure, and separate from the components that use it, because every mistake
// available here is a silent one: a preset computed in the wrong direction
// sends a message a week early, and a datetime-local value parsed as UTC
// sends it at the wrong hour for everyone outside London.
//
// Formatted with date-fns, never `toLocaleString()` -- see lib/webmail/dates.

import { addDays, format, isValid, nextMonday, parseISO, startOfDay } from 'date-fns';

/**
 * How far ahead a time has to be before it can be picked.
 *
 * The mail server's own floor is one minute (SCHEDULED_SEND_MIN_LEAD_SECONDS)
 * and it sweeps every 30 seconds. Two minutes here means the person is never
 * shown a time that the server then refuses because they took a moment to
 * press the button.
 */
export const MIN_LEAD_MINUTES = 2;

const MORNING_HOUR = 8;
const AFTERNOON_HOUR = 13;

export interface SchedulePreset {
  key: string;
  /** "Tomorrow morning" */
  label: string;
  /** "Sep 15, 8:00 AM" */
  when: string;
  at: Date;
}

function atHour(day: Date, hour: number): Date {
  const result = startOfDay(day);
  result.setHours(hour, 0, 0, 0);
  return result;
}

/**
 * "Tue, Sep 15, 8:00 AM" -- a scheduled time on its own, in the message list
 * and in the confirmation. The weekday earns its place there: it answers
 * "when is this going out" without the reader working it out from a date.
 */
export function formatSendAt(date: Date): string {
  return isValid(date) ? format(date, 'EEE, MMM d, h:mm a') : '—';
}

/**
 * "Sep 15, 8:00 AM" -- the same time beside a preset that already names the
 * day. "Monday morning ... Mon, Sep 21" says Monday twice, and the extra
 * four characters were enough to wrap "Tomorrow afternoon" onto a second
 * line and leave the menu with uneven rows.
 */
export function formatScheduleHint(date: Date): string {
  return isValid(date) ? format(date, 'MMM d, h:mm a') : '—';
}

/**
 * The offered times, soonest first.
 *
 * On a Sunday, "Monday morning" and "Tomorrow morning" are the same instant;
 * the duplicate is dropped rather than shown twice under two names.
 */
export function schedulePresets(now: Date = new Date()): SchedulePreset[] {
  const tomorrow = addDays(now, 1);

  const candidates: Array<{ key: string; label: string; at: Date }> = [
    { key: 'tomorrow-morning', label: 'Tomorrow morning', at: atHour(tomorrow, MORNING_HOUR) },
    {
      key: 'tomorrow-afternoon',
      label: 'Tomorrow afternoon',
      at: atHour(tomorrow, AFTERNOON_HOUR),
    },
    { key: 'monday-morning', label: 'Monday morning', at: atHour(nextMonday(now), MORNING_HOUR) },
  ];

  const seen = new Set<number>();
  return candidates
    .filter((candidate) => {
      if (!canSchedule(candidate.at, now)) return false;
      const instant = candidate.at.getTime();
      if (seen.has(instant)) return false;
      seen.add(instant);
      return true;
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((candidate) => ({ ...candidate, when: formatScheduleHint(candidate.at) }));
}

/** Whether a chosen time is far enough ahead to be accepted. */
export function canSchedule(at: Date, now: Date = new Date()): boolean {
  if (!isValid(at)) return false;
  return at.getTime() - now.getTime() >= MIN_LEAD_MINUTES * 60_000;
}

/**
 * What an <input type="datetime-local"> wants: local wall-clock time, no
 * zone. Built with date-fns rather than `toISOString().slice(0, 16)`, which
 * is the usual shortcut and is wrong by the viewer's UTC offset -- it would
 * open the picker an hour off for half of Europe and five for Lagos.
 */
export function toDateTimeLocalValue(date: Date): string {
  return isValid(date) ? format(date, "yyyy-MM-dd'T'HH:mm") : '';
}

/**
 * The reverse. A datetime-local value carries no offset and means local
 * time; parseISO reads it that way, so the instant sent to the server is the
 * one the person saw in the picker.
 */
export function fromDateTimeLocalValue(value: string): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

/** The earliest the custom picker will accept, as an input value. */
export function earliestPickable(now: Date = new Date()): string {
  return toDateTimeLocalValue(new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000));
}

/**
 * What the custom picker opens on: the next WHOLE hour.
 *
 * It used to open on `now + 1 hour`, which is a reasonable default almost
 * everywhere and a terrible one here. At 02:13 in Lagos (UTC+1) the field
 * read 03:12 -- a time exactly one hour ahead, carrying the current minutes,
 * which is indistinguishable from a picker quietly applying the UTC offset.
 * It was reported as a timezone bug, and it looked like one.
 *
 * A whole hour cannot be misread that way: 02:13 opens on 03:00, and no
 * offset produces a time ending in :00 from one ending in :13. It is also
 * the tidier default -- nobody schedules mail for 03:12.
 */
export function defaultPickerTime(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  // 09:59 would otherwise open on a 10:00 the field's own `min` rejects.
  if (!canSchedule(next, now)) next.setHours(next.getHours() + 1);
  return next;
}

/**
 * "UTC+1" -- which clock the picker is speaking, said out loud.
 *
 * Every time in this feature is the viewer's local time, but a scheduling
 * control gives nobody a reason to believe that, so it says so.
 *
 * Built from getTimezoneOffset rather than
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`, which would give a
 * nicer "Africa/Lagos" and is exactly the no-locale Intl call that THROWS on
 * Android devices with a malformed default locale -- the crash lib/webmail/
 * dates.ts exists to keep out of this app.
 */
export function localZoneLabel(now: Date = new Date()): string {
  // getTimezoneOffset returns minutes to ADD to local to reach UTC, so it is
  // positive west of Greenwich -- the opposite sign to how a zone is written.
  const minutes = -now.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return rest
    ? `UTC${sign}${hours}:${String(rest).padStart(2, '0')}`
    : `UTC${sign}${hours}`;
}
