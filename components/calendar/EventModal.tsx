'use client';

/**
 * Create, edit and delete one event.
 *
 * Laid out the way Google Calendar's editor is: a large title, then one row
 * per property with its icon in a gutter on the left, fields drawn as soft
 * wells rather than a grid of bordered boxes, and guests shown as people --
 * a face, a name and their answer -- rather than as a list of addresses.
 */

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  AlignLeft,
  Bell,
  CalendarDays,
  Check,
  CircleHelp,
  Clock,
  DoorOpen,
  Globe,
  MapPin,
  Repeat,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';
import {
  checkAvailability,
  clashes,
  deliveryState,
  type Availability,
  type CalendarEvent,
  type EventDraft,
  type Room,
} from '@/lib/webmail/calendar';
import { useRooms } from '@/lib/webmail/query/calendarQueries';
import { useIsMobile } from '@/lib/webmail/useIsMobile';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/Field';
import IconButton from '@/components/ui/IconButton';
import { StatusBadge } from '@/components/ui/Pill';
import { Swatch } from '@/components/ui/SelectMenu';

const NO_ROOMS: Room[] = [];

type Props = {
  event: CalendarEvent | null;
  initialStart: Date | null;
  initialAllDay: boolean;
  readOnly: boolean;
  saving: boolean;
  error: string | null;
  /** The calendar the event is in, or is being added to. */
  calendarName: string | null;
  /** That calendar's colour (calendarColour), or null. */
  colour: string | null;
  onClose: () => void;
  onSave: (draft: EventDraft) => void;
  onDelete: () => void;
  onUnauthorized: () => void;
};

const REPEATS: { label: string; value: string | null }[] = [
  { label: 'Does not repeat', value: null },
  { label: 'Every day', value: 'FREQ=DAILY' },
  { label: 'Every week', value: 'FREQ=WEEKLY' },
  { label: 'Every weekday', value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Every month', value: 'FREQ=MONTHLY' },
  { label: 'Every year', value: 'FREQ=YEARLY' },
];

/**
 * The preset an event's repeat rule is, or starts as: the rule itself, or
 * the longest preset followed by `;` (an UNTIL or a COUNT on the end).
 * Longest, not first: 'FREQ=WEEKLY' is also the start of the weekday rule,
 * and matching presets in order with startsWith opened every "Every weekday"
 * event as "Every week" -- and saving it made it weekly.
 */
function presetFor(rule: string): (typeof REPEATS)[number] | null {
  return (
    REPEATS.filter((r) => r.value !== null && (rule === r.value || rule.startsWith(`${r.value};`))).sort(
      (a, b) => (b.value?.length ?? 0) - (a.value?.length ?? 0),
    )[0] ?? null
  );
}

/**
 * Matches the server's cap. Each reminder becomes a VALARM that every synced
 * device turns into its own alert, so the ceiling is a kindness rather than
 * a restriction.
 */
const REMINDER_LIMIT = 10;

const REMINDERS: { label: string; value: number | null }[] = [
  { label: 'No reminder', value: null },
  { label: '5 minutes before', value: 5 },
  { label: '15 minutes before', value: 15 },
  { label: '30 minutes before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '1 day before', value: 1440 },
];

/**
 * The browser's own zone, used as the TZID for events created here.
 *
 * Wrapped because `Intl` can throw on a device with a malformed locale --
 * which is exactly how a bare `toLocaleString` once crashed this app on
 * Android. Falling back to UTC gives a working, if blunt, calendar rather
 * than a blank screen.
 */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function toDateInput(value: Date): string {
  return format(value, 'yyyy-MM-dd');
}

function toTimeInput(value: Date): string {
  return format(value, 'HH:mm');
}

/**
 * `base` moved to the day a date field holds, at the same time of day. The
 * start and end were one datetime-local field each; split into a date and a
 * time, each half changes only its own part. A half-typed value changes
 * nothing.
 */
function withDate(base: Date, value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return base;
  const next = new Date(base);
  next.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return next;
}

/** `base` at the time a time field holds, on the same day. */
function withTime(base: Date, value: string): Date {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return base;
  const next = new Date(base);
  next.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return next;
}

/**
 * A guest's answer (their iCalendar PARTSTAT) in words, and the badge drawn
 * on their avatar. Only guests who were actually invited have one.
 */
function responseOf(status: string): { label: string; badge: string | null; icon: typeof Check | null } {
  switch (status.toUpperCase()) {
    case 'ACCEPTED':
      return { label: 'Accepted', badge: 'bg-success', icon: Check };
    case 'DECLINED':
      return { label: 'Declined', badge: 'bg-destructive', icon: X };
    case 'TENTATIVE':
      return { label: 'Maybe', badge: 'bg-warning', icon: CircleHelp };
    case 'DELEGATED':
      return { label: 'Delegated', badge: null, icon: null };
    default:
      return { label: 'Awaiting reply', badge: null, icon: null };
  }
}

/**
 * One property of the event: its icon in a 20px gutter, the control beside
 * it. `top` pins the icon to the first 38px field of a taller stack rather
 * than the middle of it.
 */
function Row({ icon, top = false, children }: { icon: React.ReactNode; top?: boolean; children: React.ReactNode }) {
  return (
    <div className={['flex gap-3', top ? 'items-start' : 'items-center'].join(' ')}>
      <span
        aria-hidden
        className={['flex w-5 shrink-0 justify-center text-muted-foreground', top ? 'mt-[10px]' : ''].join(' ')}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default function EventModal({
  event,
  initialStart,
  initialAllDay,
  readOnly,
  saving,
  error,
  calendarName,
  colour,
  onClose,
  onSave,
  onDelete,
  onUnauthorized,
}: Props) {
  const isMobile = useIsMobile();

  const seedStart = useMemo(() => {
    if (event) return new Date(event.start);
    if (initialStart) return initialStart;
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return now;
  }, [event, initialStart]);

  const seedEnd = useMemo(() => {
    if (event?.end) return new Date(event.end);
    return new Date(seedStart.getTime() + 60 * 60000);
  }, [event, seedStart]);

  const [summary, setSummary] = useState(event?.summary ?? '');
  const [allDay, setAllDay] = useState(event?.all_day ?? initialAllDay);
  const [start, setStart] = useState(seedStart);
  const [end, setEnd] = useState(seedEnd);
  const [location, setLocation] = useState(event?.location ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  /*
   * The event's own rule, kept verbatim. Only a preset the person picks
   * replaces it.
   *
   * This used to be snapped to the nearest preset on open, so saving any
   * change -- a new title -- rewrote the rule: an UNTIL or a COUNT was
   * dropped (a series that should end ran forever), and "Every weekday"
   * came back as "Every week". A rule that is not exactly a preset is shown
   * as its own first option, "<closest> (as set)", so an untouched save
   * sends it back as it came.
   */
  const [rrule, setRrule] = useState<string | null>(event?.rrule || null);
  const repeatOptions = useMemo(() => {
    const own = event?.rrule;
    if (!own || REPEATS.some((r) => r.value === own)) return REPEATS;
    return [{ label: `${presetFor(own)?.label ?? 'Custom'} (as set)`, value: own }, ...REPEATS];
  }, [event]);
  /*
   * The event's OWN reminders, not a guess.
   *
   * This read `event?.alarms ? 15 : null` — the API returned only a count,
   * so the modal showed "15 minutes before" for any event that had a
   * reminder at all, and then saved that. Opening an event with a one-hour
   * reminder and changing its title silently moved the reminder to fifteen
   * minutes. The API now returns the real offsets.
   */
  const [reminders, setReminders] = useState<number[]>(event?.reminders ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [guests, setGuests] = useState<string[]>(
    () => (event?.attendees ?? []).map((a) => a.email),
  );
  const [guestInput, setGuestInput] = useState('');
  const [availability, setAvailability] = useState<Availability[]>([]);

  // Keep the end after the start rather than letting the server reject it:
  // being told "end must be after start" after typing is worse than the field
  // simply following along.
  useEffect(() => {
    if (end < start) setEnd(new Date(start.getTime() + 60 * 60000));
  }, [start, end]);

  /**
   * A new start carries the end with it, keeping the event's length, as
   * Google Calendar does: a 10:00-11:00 meeting moved to 08:00 stays an hour
   * long instead of quietly growing to three.
   */
  function moveStart(next: Date) {
    const length = Math.max(0, end.getTime() - start.getTime());
    setStart(next);
    setEnd(new Date(next.getTime() + length));
  }

  // Most organizations have no rooms, and that is the normal case: this
  // resolves to an empty list and the room controls never render. Failure
  // is treated the same way -- a meeting you can still create without a
  // room beats a modal that refuses to open because a side lookup failed.
  // Cached for the session: every dialog after the first opens with them.
  const rooms = useRooms().data ?? NO_ROOMS;

  // Availability, refreshed when the guest list or the slot changes. Debounced
  // because this is an organization-directory lookup, not a local calculation:
  // one request per keystroke would make it a scraping API.
  useEffect(() => {
    if (guests.length === 0 || allDay) {
      setAvailability([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const res = await checkAvailability(guests, start, end, onUnauthorized);
      if (res.success) setAvailability(res.data);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [guests, start, end, allDay, onUnauthorized]);

  // A room is an attendee like any other once it is on the meeting -- the
  // distinction is presentational. Showing `boardroom@company.com` in the
  // guest list when the person picked "Boardroom" from a list is the kind
  // of leak that makes software feel like plumbing.
  const roomByEmail = useMemo(() => new Map(rooms.map((r) => [r.email, r])), [rooms]);
  const availableRooms = rooms.filter((r) => !guests.includes(r.email));

  function addGuest() {
    const value = guestInput.trim().toLowerCase();
    if (!value || !value.includes('@') || guests.includes(value)) {
      setGuestInput('');
      return;
    }
    setGuests((current) => [...current, value]);
    setGuestInput('');
  }

  const canSave = summary.trim().length > 0 && !saving && !readOnly;

  function submit() {
    if (!canSave) return;
    onSave({
      summary: summary.trim(),
      start: start.toISOString(),
      end: end.toISOString(),
      timezone_id: allDay ? null : browserTimezone(),
      all_day: allDay,
      location: location.trim() || null,
      description: description.trim() || null,
      rrule,
      reminders,
      attendees: guests.map((email) => ({ email })),
    });
  }

  const undelivered = (event?.attendees ?? []).filter(
    (a) => deliveryState(a.schedule_status) === 'undelivered',
  );

  const organizerEmail = event?.organizer?.email.toLowerCase() ?? null;

  // "4 guests · 3 yes · 1 awaiting". Answers count only for guests who were
  // actually invited; someone added in this dialog has not been asked yet.
  const guestSummary = useMemo(() => {
    const counts = { yes: 0, no: 0, maybe: 0, awaiting: 0 };
    for (const email of guests) {
      const status = event?.attendees.find((a) => a.email === email)?.status.toUpperCase();
      if (!status) continue;
      if (status === 'ACCEPTED') counts.yes += 1;
      else if (status === 'DECLINED') counts.no += 1;
      else if (status === 'TENTATIVE') counts.maybe += 1;
      else counts.awaiting += 1;
    }
    const answers = (Object.entries(counts) as [string, number][])
      .filter(([, n]) => n > 0)
      .map(([word, n]) => `${n} ${word}`);
    return [`${guests.length} ${guests.length === 1 ? 'guest' : 'guests'}`, ...answers].join(' · ');
  }, [guests, event]);

  const title = !event ? 'New event' : readOnly ? 'Event details' : 'Edit event';

  const footer = (
    <>
      {event && !readOnly && (
        <div className="mr-auto flex items-center gap-2">
          {confirmDelete ? (
            <>
              <span className="text-[13px] text-muted-foreground">Delete this event?</span>
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex h-8 items-center rounded-md bg-destructive px-3 text-[12.5px] font-semibold text-destructive-foreground transition-[filter] hover:brightness-95"
              >
                Yes, delete
              </button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={onClose}>
        {readOnly ? 'Close' : 'Cancel'}
      </Button>
      {!readOnly && (
        <Button variant="primary" size="sm" busy={saving} disabled={!canSave} onClick={submit}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      )}
    </>
  );

  return (
    <Dialog open onClose={onClose} title={title} footer={footer}>
      <div className="space-y-4">
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <input
          id="event-summary"
          aria-label="Title"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onKeyDown={(e) => {
            // Enter in the title saves, as it does in Google Calendar -- but
            // not the Enter that confirms an input method's candidate, which
            // Safari reports with isComposing false and keyCode 229.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={readOnly}
          // Not on a phone, where the keyboard would cover half the sheet.
          autoFocus={!event && !readOnly && !isMobile}
          placeholder="Add a title"
          className="w-full border-0 border-b-2 border-border bg-transparent px-0 pb-2 pt-1 font-display text-[22px] font-semibold tracking-tight text-foreground outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground/70 focus:border-primary disabled:opacity-70"
        />

        <Row icon={<Clock size={18} />} top>
          <div
            className={[
              'grid items-center gap-2',
              allDay
                ? 'grid-cols-[2.25rem_minmax(0,1fr)]'
                : 'grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,6.75rem)]',
            ].join(' ')}
          >
            <span className="text-xs font-medium text-muted-foreground">From</span>
            {/* withDate sets the date input's y/m/d on the existing LOCAL
                Date rather than re-parsing the bare "yyyy-MM-dd" it hands
                back -- that string parses as UTC midnight, which reads a day
                early in any timezone behind UTC. All-day events want this
                just as much as timed ones: moveStart drags the end along by
                the same (wrong) offset otherwise. */}
            <Input
              variant="filled"
              id="event-start"
              aria-label="Start date"
              type="date"
              value={toDateInput(start)}
              disabled={readOnly}
              onChange={(e) => e.target.value && moveStart(withDate(start, e.target.value))}
              className="h-[38px]"
            />
            {!allDay && (
              <Input
                variant="filled"
                id="event-start-time"
                aria-label="Start time"
                type="time"
                value={toTimeInput(start)}
                disabled={readOnly}
                onChange={(e) => e.target.value && moveStart(withTime(start, e.target.value))}
                className="h-[38px]"
              />
            )}
            <span className="text-xs font-medium text-muted-foreground">To</span>
            <Input
              variant="filled"
              id="event-end"
              aria-label="End date"
              type="date"
              value={toDateInput(end)}
              disabled={readOnly}
              onChange={(e) => e.target.value && setEnd(withDate(end, e.target.value))}
              className="h-[38px]"
            />
            {!allDay && (
              <Input
                variant="filled"
                id="event-end-time"
                aria-label="End time"
                type="time"
                value={toTimeInput(end)}
                disabled={readOnly}
                onChange={(e) => e.target.value && setEnd(withTime(end, e.target.value))}
                className="h-[38px]"
              />
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <Checkbox id="event-all-day" checked={allDay} disabled={readOnly} onChange={(e) => setAllDay(e.target.checked)} />
              All day
            </label>
            {!allDay && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe size={13} aria-hidden />
                Times are in {browserTimezone()}
              </span>
            )}
          </div>
        </Row>

        <Row icon={<Repeat size={18} />}>
          <Select
            variant="filled"
            id="event-repeat"
            aria-label="Repeat"
            value={rrule ?? ''}
            disabled={readOnly}
            onChange={(e) => setRrule(e.target.value || null)}
          >
            {repeatOptions.map((option) => (
              <option key={option.label} value={option.value ?? ''}>
                {option.label}
              </option>
            ))}
          </Select>
        </Row>

        {/* One row per reminder. A calendar people already use lets them
            set "a day before" AND "ten minutes before"; a single select
            could only ever hold the last one they picked. */}
        <Row icon={<Bell size={18} />} top>
          <div className="flex flex-col gap-2">
            {reminders.length === 0 && (
              <Select
                variant="filled"
                id="event-reminder"
                aria-label="Reminder"
                value=""
                disabled={readOnly}
                onChange={(e) => e.target.value && setReminders([Number(e.target.value)])}
              >
                {REMINDERS.map((option) => (
                  <option key={option.label} value={option.value ?? ''}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}

            {reminders.map((minutes, index) => (
              <div key={`${minutes}-${index}`} className="flex items-center gap-1.5">
                <Select
                  variant="filled"
                  id={index === 0 ? 'event-reminder' : undefined}
                  value={minutes}
                  disabled={readOnly}
                  aria-label={`Reminder ${index + 1}`}
                  onChange={(e) => {
                    const next = [...reminders];
                    if (!e.target.value) next.splice(index, 1);
                    else next[index] = Number(e.target.value);
                    setReminders(next);
                  }}
                  className="min-w-0 flex-1"
                >
                  {REMINDERS.map((option) => (
                    <option key={option.label} value={option.value ?? ''}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                {!readOnly && (
                  <IconButton
                    label={`Remove reminder ${index + 1}`}
                    size="sm"
                    onClick={() => setReminders(reminders.filter((_, i) => i !== index))}
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            ))}

            {/* Offered only once there is something to add to, and only
                while an unused option remains — a chooser whose every
                entry is already taken is a dead control. */}
            {!readOnly &&
              reminders.length > 0 &&
              reminders.length < REMINDER_LIMIT &&
              REMINDERS.some((o) => o.value !== null && !reminders.includes(o.value)) && (
                <button
                  type="button"
                  onClick={() => {
                    const free = REMINDERS.find((o) => o.value !== null && !reminders.includes(o.value));
                    if (free?.value != null) setReminders([...reminders, free.value]);
                  }}
                  className="self-start rounded-md px-1 py-0.5 text-[13px] font-semibold text-primary hover:underline"
                >
                  Add another reminder
                </button>
              )}
          </div>
        </Row>

        <Row icon={<MapPin size={18} />}>
          <Input
            variant="filled"
            id="event-location"
            aria-label="Location"
            value={location}
            disabled={readOnly}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Add a location"
          />
        </Row>

        <Row icon={<AlignLeft size={18} />} top>
          <Textarea
            variant="filled"
            id="event-description"
            aria-label="Description"
            value={description}
            disabled={readOnly}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description"
            rows={3}
            className="resize-y"
          />
        </Row>

        {calendarName && (
          <Row icon={<CalendarDays size={18} />}>
            <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
              <Swatch colour={colour} />
              <span className="truncate">{calendarName}</span>
            </span>
          </Row>
        )}

        {/* Guests. Editable now that invitations actually leave the
            building -- an address on this server is delivered into its
            owner's scheduling inbox, and anyone else is emailed an iMIP
            invitation. Each guest's delivery outcome is shown after saving,
            because an invitation that looks sent and was not is the failure
            this feature exists to avoid. */}
        {(!readOnly || guests.length > 0) && (
          <Row icon={<Users size={18} />} top>
            <div className="space-y-2">
              {!readOnly && (
                <Input
                  variant="filled"
                  id="event-guest"
                  aria-label="Add a guest by email"
                  inputMode="email"
                  autoComplete="off"
                  value={guestInput}
                  onChange={(e) => setGuestInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter and comma both commit. Requiring a button press
                    // for each guest is how a five-person meeting becomes
                    // five mistakes.
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addGuest();
                    }
                  }}
                  onBlur={addGuest}
                  placeholder="Add a guest by email"
                />
              )}

              {/* Rooms first, and only when there are any. A room is the thing
                  people come here to book; making them recall its address was
                  the single reason rooms went unused. Hidden entirely for an
                  organisation with none, rather than shown as an empty list. */}
              {!readOnly && availableRooms.length > 0 && (
                <>
                  <label htmlFor="event-room" className="sr-only">
                    Add a room
                  </label>
                  <Select
                    variant="filled"
                    id="event-room"
                    value=""
                    onChange={(e) => {
                      const email = e.target.value;
                      if (email && !guests.includes(email)) {
                        setGuests((current) => [...current, email]);
                      }
                    }}
                  >
                    <option value="">Add a room or equipment&hellip;</option>
                    {availableRooms.map((room) => (
                      <option key={room.email} value={room.email}>
                        {room.name}
                        {room.capacity ? ` (${room.capacity} seats)` : ''}
                        {room.location ? ` — ${room.location}` : ''}
                      </option>
                    ))}
                  </Select>
                </>
              )}

              {guests.length > 0 && (
                <>
                  <p className="px-0.5 pt-1 text-xs font-medium text-muted-foreground">{guestSummary}</p>
                  <ul className="-mx-1.5 space-y-0.5">
                    {guests.map((email) => {
                      const existing = event?.attendees.find((a) => a.email === email);
                      const room = roomByEmail.get(email);
                      const state = deliveryState(existing?.schedule_status ?? null);
                      const avail = availability.find((a) => a.email === email);
                      const busy = avail ? clashes(avail, start, end) : false;
                      const response = existing ? responseOf(existing.status) : null;
                      const Badge = response?.icon ?? null;
                      const isOrganizer = !room && organizerEmail === email.toLowerCase();
                      const detail = [
                        room
                          ? room.capacity
                            ? `${room.capacity} seats`
                            : room.type === 'RESOURCE'
                              ? 'Equipment'
                              : 'Room'
                          : existing?.name
                            ? email
                            : null,
                        isOrganizer ? 'Organizer' : null,
                        response?.label ?? null,
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <li key={email} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/60">
                          <span className="relative shrink-0">
                            {room ? (
                              <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                <DoorOpen size={15} />
                              </span>
                            ) : (
                              <Avatar name={existing?.name ?? email} email={email} size={32} />
                            )}
                            {response?.badge && Badge && (
                              <span
                                aria-hidden
                                className={[
                                  'absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-background ring-2 ring-card',
                                  response.badge,
                                ].join(' ')}
                              >
                                <Badge size={9} strokeWidth={3.5} />
                              </span>
                            )}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-foreground">
                              {room?.name ?? existing?.name ?? email}
                            </span>
                            {detail && <span className="block truncate text-[11.5px] text-muted-foreground">{detail}</span>}
                          </span>

                          {/* Three distinct states, and the third is the one that
                              matters: "we could not ask" must never be drawn to
                              look like "free". */}
                          {avail && (
                            <span
                              className="shrink-0"
                              title={!avail.known ? 'Availability is only known for people in your organisation' : undefined}
                            >
                              <StatusBadge tone={!avail.known ? 'neutral' : busy ? 'warning' : 'success'}>
                                {!avail.known ? 'Unknown' : busy ? 'Busy then' : 'Free'}
                              </StatusBadge>
                            </span>
                          )}

                          {state === 'undelivered' && (
                            <span className="shrink-0" title={existing?.schedule_status ?? undefined}>
                              <StatusBadge tone="warning" className="gap-1">
                                <TriangleAlert size={11} aria-hidden />
                                Not delivered
                              </StatusBadge>
                            </span>
                          )}

                          {!readOnly && (
                            <IconButton
                              label={`Remove ${email}`}
                              size="xs"
                              onClick={() => setGuests((c) => c.filter((g) => g !== email))}
                            >
                              <X size={13} />
                            </IconButton>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {undelivered.length > 0 && (
                <p role="status" className="flex items-start gap-2 rounded-lg bg-warning/[0.1] px-3 py-2 text-xs text-warning">
                  <TriangleAlert size={14} aria-hidden className="mt-px shrink-0" />
                  Some guests could not be told about this event. They have not received an invitation.
                </p>
              )}
            </div>
          </Row>
        )}

        {event?.recurring && (
          <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Repeat size={14} aria-hidden className="mt-px shrink-0" />
            This event repeats. Saving changes every occurrence.
          </p>
        )}
      </div>
    </Dialog>
  );
}
