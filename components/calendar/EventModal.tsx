'use client';

/** Create, edit and delete one event. */

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Check, Clock, DoorOpen, MapPin, Repeat, Trash2, Users, X } from 'lucide-react';
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
import { Input, Select, Textarea } from '@/components/ui/Field';

const NO_ROOMS: Room[] = [];

type Props = {
  event: CalendarEvent | null;
  initialStart: Date | null;
  initialAllDay: boolean;
  readOnly: boolean;
  saving: boolean;
  error: string | null;
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

function toLocalInput(value: Date): string {
  return format(value, "yyyy-MM-dd'T'HH:mm");
}

function toDateInput(value: Date): string {
  return format(value, 'yyyy-MM-dd');
}

export default function EventModal({
  event,
  initialStart,
  initialAllDay,
  readOnly,
  saving,
  error,
  onClose,
  onSave,
  onDelete,
  onUnauthorized,
}: Props) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A picker or menu inside the modal closes first, on its own.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the end after the start rather than letting the server reject it:
  // being told "end must be after start" after typing is worse than the field
  // simply following along.
  useEffect(() => {
    if (end < start) setEnd(new Date(start.getTime() + 60 * 60000));
  }, [start, end]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={event ? 'Edit event' : 'New event'}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">{event ? 'Event' : 'New event'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {error && (
            <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </p>
          )}

          <input
            id="event-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            disabled={readOnly}
            placeholder="Add a title"
            className="w-full border-0 border-b border-neutral-200 bg-transparent pb-2 text-lg outline-none focus:border-primary disabled:opacity-60 dark:border-neutral-700"
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              id="event-all-day"
              type="checkbox"
              checked={allDay}
              disabled={readOnly}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            All day
          </label>

          {/* Icons beside a stack sit at (38 - 16) / 2 = 11px: centred on the first 38px field. */}
          <div className="flex items-start gap-2">
            <Clock size={16} className="mt-[11px] shrink-0 text-muted-foreground" />
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              {/* Pinned to 38px: Chrome draws a date field 2px taller than
                  text (its picker button), a step against the selects below. */}
              <Input
                id="event-start"
                aria-label="Starts"
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? toDateInput(start) : toLocalInput(start)}
                disabled={readOnly}
                onChange={(e) => e.target.value && setStart(new Date(e.target.value))}
                className="h-[38px]"
              />
              <Input
                id="event-end"
                aria-label="Ends"
                type={allDay ? 'date' : 'datetime-local'}
                value={allDay ? toDateInput(end) : toLocalInput(end)}
                disabled={readOnly}
                onChange={(e) => e.target.value && setEnd(new Date(e.target.value))}
                className="h-[38px]"
              />
            </div>
          </div>

          {!allDay && (
            <p className="pl-6 text-xs text-neutral-500 dark:text-neutral-400">
              Times are in {browserTimezone()}.
            </p>
          )}

          <div className="flex items-center gap-2">
            <Repeat size={16} className="shrink-0 text-muted-foreground" />
            <Select
              id="event-repeat"
              aria-label="Repeat"
              value={rrule ?? ''}
              disabled={readOnly}
              onChange={(e) => setRrule(e.target.value || null)}
              className="min-w-0 flex-1"
            >
              {repeatOptions.map((option) => (
                <option key={option.label} value={option.value ?? ''}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          {/* One row per reminder. A calendar people already use lets them
              set "a day before" AND "ten minutes before"; a single select
              could only ever hold the last one they picked. */}
          <div className="flex gap-2">
            <Check size={16} className="mt-[11px] shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {reminders.length === 0 && (
                <Select
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
                <div key={`${minutes}-${index}`} className="flex items-center gap-2">
                  <Select
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
                    <button
                      type="button"
                      onClick={() => setReminders(reminders.filter((_, i) => i !== index))}
                      aria-label={`Remove reminder ${index + 1}`}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}

              {/* Offered only once there is something to add to, and only
                  while an unused option remains — a chooser whose every
                  entry is already taken is a dead control. */}
              {!readOnly
                && reminders.length > 0
                && reminders.length < REMINDER_LIMIT
                && REMINDERS.some((o) => o.value !== null && !reminders.includes(o.value)) && (
                <button
                  type="button"
                  onClick={() => {
                    const free = REMINDERS.find(
                      (o) => o.value !== null && !reminders.includes(o.value),
                    );
                    if (free?.value != null) setReminders([...reminders, free.value]);
                  }}
                  className="self-start text-xs text-primary hover:underline"
                >
                  Add another reminder
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <MapPin size={16} className="shrink-0 text-muted-foreground" />
            <Input
              id="event-location"
              aria-label="Location"
              value={location}
              disabled={readOnly}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Add a location"
              className="min-w-0 flex-1"
            />
          </div>

          <Textarea
            id="event-description"
            aria-label="Description"
            value={description}
            disabled={readOnly}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description"
            rows={3}
          />

          {/* Guests. Editable now that invitations actually leave the
              building -- an address on this server is delivered into its
              owner's scheduling inbox, and anyone else is emailed an iMIP
              invitation. Each guest's delivery outcome is shown after saving,
              because an invitation that looks sent and was not is the failure
              this feature exists to avoid. */}
          <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <Users size={14} /> Guests
            </div>

            {/* Rooms first, and only when there are any. A room is the thing
                people come here to book; making them recall its address was
                the single reason rooms went unused. Hidden entirely for an
                organisation with none, rather than shown as an empty list. */}
            {!readOnly && availableRooms.length > 0 && (
              <div className="mb-2">
                <label htmlFor="event-room" className="sr-only">
                  Add a room
                </label>
                <Select
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
              </div>
            )}

            {!readOnly && (
              <div className="mb-2 flex gap-2">
                <Input
                  id="event-guest"
                  aria-label="Add a guest by email"
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
                  className="min-w-0 flex-1"
                />
              </div>
            )}

            {guests.length === 0 ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">No guests.</p>
            ) : (
              <ul className="space-y-1.5">
                {guests.map((email) => {
                  const existing = event?.attendees.find((a) => a.email === email);
                  const room = roomByEmail.get(email);
                  const state = deliveryState(existing?.schedule_status ?? null);
                  const avail = availability.find((a) => a.email === email);
                  const busy = avail ? clashes(avail, start, end) : false;
                  return (
                    <li key={email} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                        {room && <DoorOpen size={13} className="shrink-0 text-muted-foreground" />}
                        {room?.name ?? existing?.name ?? email}
                        {room?.capacity ? (
                          <span className="shrink-0 text-xs text-neutral-500">
                            {room.capacity} seats
                          </span>
                        ) : null}
                        {existing && (
                          <span className="ml-1 text-xs text-neutral-500">
                            {existing.status.toLowerCase()}
                          </span>
                        )}
                      </span>

                      {/* Three distinct states, and the third is the one that
                          matters: "we could not ask" must never be drawn to
                          look like "free". */}
                      {avail && (
                        <span
                          className={
                            !avail.known
                              ? 'shrink-0 text-xs text-neutral-400'
                              : busy
                                ? 'shrink-0 text-xs text-warning'
                                : 'shrink-0 text-xs text-primary'
                          }
                          title={
                            !avail.known
                              ? 'Availability is only known for people in your organisation'
                              : undefined
                          }
                        >
                          {!avail.known ? 'unknown' : busy ? 'busy then' : 'free'}
                        </span>
                      )}

                      {state === 'undelivered' && (
                        <span
                          className="flex shrink-0 items-center gap-1 text-xs text-warning"
                          title={existing?.schedule_status ?? undefined}
                        >
                          <AlertTriangle size={12} /> not delivered
                        </span>
                      )}

                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => setGuests((c) => c.filter((g) => g !== email))}
                          aria-label={`Remove ${email}`}
                          className="shrink-0 rounded p-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {undelivered.length > 0 && (
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                Some guests could not be told about this event. They have not
                received an invitation.
              </p>
            )}
          </div>

          {event?.recurring && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              This event repeats. Saving changes every occurrence.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
          {event && !readOnly ? (
            confirmDelete ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-neutral-600 dark:text-neutral-300">Delete?</span>
                <button type="button" onClick={onDelete} className="rounded bg-rose-600 px-2 py-1 text-xs text-white">
                  Yes, delete
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs underline">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-sm text-rose-600 hover:underline dark:text-rose-400"
              >
                <Trash2 size={14} /> Delete
              </button>
            )
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={submit}
                disabled={!canSave}
                className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
