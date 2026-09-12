'use client';

/**
 * The calendar screen.
 *
 * Gated on the server's `calendar` capability, like every other optional
 * feature here: a deployment without the DAV service renders no calendar at
 * all rather than a screen whose every action fails. That is this app's
 * stated rule -- optional features are absent, not disabled.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Link2, Mail, Plus } from 'lucide-react';
import { AgendaView, MonthView, WeekView, type ViewMode } from '@/components/calendar/CalendarViews';
import EventModal from '@/components/calendar/EventModal';
import {
  createEvent,
  deleteEvent,
  listCalendars,
  listEvents,
  updateEvent,
  type CalendarEvent,
  type CalendarSummary,
  type EventDraft,
} from '@/lib/webmail/calendar';

const WEEK_OPTS = { weekStartsOn: 1 as const };

export default function CalendarPage() {
  const router = useRouter();
  const onUnauthorized = useCallback(() => router.replace('/login'), [router]);

  const [supported, setSupported] = useState<boolean | null>(null);
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [active, setActive] = useState('default');
  const [view, setView] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);

  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creatingAt, setCreatingAt] = useState<{ start: Date; allDay: boolean } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // The range currently on screen. Month view shows leading and trailing days
  // from the neighbouring months, so the query has to cover the whole grid or
  // those cells render empty and look like missing events.
  const range = useMemo(() => {
    if (view === 'week') {
      const start = startOfWeek(anchor, WEEK_OPTS);
      return { start, end: addDays(start, 7) };
    }
    if (view === 'agenda') {
      return { start: startOfWeek(anchor, WEEK_OPTS), end: addDays(anchor, 60) };
    }
    return {
      start: startOfWeek(startOfMonth(anchor), WEEK_OPTS),
      end: addDays(endOfWeek(endOfMonth(anchor), WEEK_OPTS), 1),
    };
  }, [anchor, view]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/webmail/capabilities', { cache: 'no-store' });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        data?: { capabilities?: Record<string, boolean> };
      };
      if (!cancelled) setSupported(Boolean(body.data?.capabilities?.calendar));
    })();
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized]);

  useEffect(() => {
    if (supported !== true) return;
    let cancelled = false;
    (async () => {
      const res = await listCalendars(onUnauthorized);
      if (cancelled) return;
      if (res.success) {
        setCalendars(res.data);
        if (!res.data.some((c) => c.uri === active)) {
          setActive(res.data[0]?.uri ?? 'default');
        }
      } else {
        setBanner(res.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `active` deliberately omitted: this reconciles the selection, and
    // depending on it would re-run every time it reconciled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, onUnauthorized]);

  // A request in flight when the range changes must not overwrite a newer
  // one's results. Without this, paging quickly through months lands on
  // whichever response happens to arrive last.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (supported !== true) return;
    const ticket = ++requestRef.current;
    setLoading(true);
    const res = await listEvents(active, range.start, range.end, onUnauthorized);
    if (ticket !== requestRef.current) return;
    if (res.success) {
      setEvents(res.data);
      setBanner(null);
    } else {
      setEvents([]);
      setBanner(res.message);
    }
    setLoading(false);
  }, [active, range.start, range.end, supported, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  const readOnly = useMemo(
    () => calendars.find((c) => c.uri === active)?.read_only ?? false,
    [calendars, active],
  );

  function openNew(start: Date, allDay: boolean) {
    if (readOnly) return;
    setEditing(null);
    setCreatingAt({ start, allDay });
    setModalError(null);
    setModalOpen(true);
  }

  function openExisting(event: CalendarEvent) {
    setEditing(event);
    setCreatingAt(null);
    setModalError(null);
    setModalOpen(true);
  }

  async function save(draft: EventDraft) {
    setSaving(true);
    setModalError(null);
    const res = editing
      ? await updateEvent(active, editing.id, editing.etag, draft, onUnauthorized)
      : await createEvent(active, draft, onUnauthorized);
    setSaving(false);
    if (!res.success) {
      setModalError(res.message);
      return;
    }
    setModalOpen(false);
    await load();
  }

  async function remove() {
    if (!editing) return;
    setSaving(true);
    const res = await deleteEvent(active, editing.id, editing.etag, onUnauthorized);
    setSaving(false);
    if (!res.success) {
      setModalError(res.message);
      return;
    }
    setModalOpen(false);
    await load();
  }

  function step(direction: -1 | 1) {
    setAnchor((current) =>
      view === 'week'
        ? addDays(current, 7 * direction)
        : direction === 1
          ? addMonths(current, 1)
          : subMonths(current, 1),
    );
  }

  if (supported === null) {
    return <div className="p-8 text-sm text-neutral-500">Loading…</div>;
  }

  if (supported === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <CalendarDays size={28} className="text-neutral-400" />
        <h1 className="text-base font-medium">No calendar on this server</h1>
        <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
          This mail server does not run a calendar service, so there is nothing
          to show here. Mail is unaffected.
        </p>
        <a href="/" className="text-sm text-teal-600 underline dark:text-teal-400">
          Back to mail
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <a
          href="/"
          className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Mail size={16} /> Mail
        </a>

        <div className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-800" />

        <button
          type="button"
          onClick={() => setAnchor(new Date())}
          className="rounded border border-neutral-200 px-2.5 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Today
        </button>
        <button type="button" onClick={() => step(-1)} aria-label="Previous" className="rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={() => step(1)} aria-label="Next" className="rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <ChevronRight size={16} />
        </button>

        <h1 className="min-w-0 truncate px-1 text-sm font-semibold">
          {view === 'week'
            ? `${format(startOfWeek(anchor, WEEK_OPTS), 'd MMM')} – ${format(addDays(startOfWeek(anchor, WEEK_OPTS), 6), 'd MMM yyyy')}`
            : format(anchor, 'MMMM yyyy')}
        </h1>

        <div className="ml-auto flex items-center gap-2">
          {calendars.length > 1 && (
            <select
              id="calendar-picker"
              value={active}
              onChange={(e) => setActive(e.target.value)}
              className="rounded border border-neutral-200 bg-transparent px-2 py-1 text-sm dark:border-neutral-700"
            >
              {calendars.map((calendar) => (
                <option key={calendar.uri} value={calendar.uri}>
                  {calendar.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex overflow-hidden rounded border border-neutral-200 dark:border-neutral-700">
            {(['month', 'week', 'agenda'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={[
                  'px-2.5 py-1 text-sm capitalize',
                  view === mode
                    ? 'bg-teal-600 text-white'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                ].join(' ')}
              >
                {mode}
              </button>
            ))}
          </div>

          <a
            href="/settings/calendar"
            className="rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Calendar settings and subscription links"
            title="Subscription links"
          >
            <Link2 size={16} />
          </a>

          {!readOnly && (
            <button
              type="button"
              onClick={() => openNew(new Date(), false)}
              className="flex items-center gap-1.5 rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              <Plus size={15} /> New
            </button>
          )}
        </div>
      </header>

      {banner && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {banner}
        </p>
      )}
      {readOnly && (
        <p className="border-b border-neutral-200 bg-neutral-50 px-4 py-1.5 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          This calendar is shared with you as read-only.
        </p>
      )}

      <main className="flex min-h-0 flex-1 flex-col">
        {/* The grid stays rendered while a range loads. Replacing it with a
            spinner makes every month change flash the whole screen. */}
        <div className={loading ? 'flex min-h-0 flex-1 flex-col opacity-60' : 'flex min-h-0 flex-1 flex-col'}>
          {view === 'month' && (
            <MonthView events={events} anchor={anchor} onSelect={openExisting} onCreateAt={openNew} />
          )}
          {view === 'week' && (
            <WeekView events={events} anchor={anchor} onSelect={openExisting} onCreateAt={openNew} />
          )}
          {view === 'agenda' && <AgendaView events={events} onSelect={openExisting} />}
        </div>
      </main>

      {modalOpen && (
        <EventModal
          event={editing}
          initialStart={creatingAt?.start ?? null}
          initialAllDay={creatingAt?.allDay ?? false}
          readOnly={readOnly}
          saving={saving}
          error={modalError}
          onClose={() => setModalOpen(false)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </div>
  );
}
