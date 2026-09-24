'use client';

/**
 * The calendar screen.
 *
 * Gated on the server's `calendar` capability, like every other optional
 * feature: a deployment without the DAV service renders no calendar at all
 * rather than a screen whose every action fails.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addDays, addMonths, endOfMonth, endOfWeek, format, isValid, parseISO, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Link2, Menu as MenuIcon, Plus } from 'lucide-react';
import { AgendaView, MonthView, WeekView, type ViewMode } from '@/components/calendar/CalendarViews';
import EventModal from '@/components/calendar/EventModal';
import InvitationsPanel from '@/components/calendar/InvitationsPanel';
import PageShell, { useOpenPageMenu } from '@/components/webmail/shell/PageShell';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import { FilterPill } from '@/components/ui/Pill';
import { Select } from '@/components/ui/Field';
import {
  createEvent,
  deleteEvent,
  listCalendars,
  listEvents,
  listInvitations,
  rsvp as sendRsvp,
  updateEvent,
  type CalendarEvent,
  type CalendarSummary,
  type EventDraft,
  type Invitation,
  type RsvpResponse,
} from '@/lib/webmail/calendar';

const WEEK_OPTS = { weekStartsOn: 1 as const };

/** `/calendar?date=2026-09-24` opens on that day (the inbox's mini calendar links here). */
function initialAnchor(): Date {
  if (typeof window === 'undefined') return new Date();
  const raw = new URLSearchParams(window.location.search).get('date');
  if (!raw) return new Date();
  const parsed = parseISO(raw);
  return isValid(parsed) ? parsed : new Date();
}

export default function CalendarPage() {
  const [supported, setSupported] = useState<boolean | null>(null);
  return (
    <PageShell current="calendar" onCapabilities={(caps) => setSupported(caps.calendar)}>
      <CalendarScreen supported={supported} />
    </PageShell>
  );
}

function CalendarScreen({ supported }: { supported: boolean | null }) {
  const router = useRouter();
  const openMenu = useOpenPageMenu();
  const onUnauthorized = useCallback(() => router.replace('/login'), [router]);

  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [active, setActive] = useState('default');
  const [view, setView] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState(initialAnchor);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);

  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationsHidden, setInvitationsHidden] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);

  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creatingAt, setCreatingAt] = useState<{ start: Date; allDay: boolean } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // The range on screen. Month view shows leading and trailing days from the
  // neighbouring months, so the query covers the whole grid.
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
    if (supported !== true) return;
    let cancelled = false;
    (async () => {
      const res = await listCalendars(onUnauthorized);
      if (cancelled) return;
      if (res.success && Array.isArray(res.data)) {
        setCalendars(res.data);
        if (!res.data.some((c) => c.uri === active)) {
          setActive(res.data[0]?.uri ?? 'default');
        }
      } else if (!res.success) {
        setBanner(res.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, onUnauthorized]);

  // A request in flight when the range changes must not overwrite a newer one.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (supported !== true) return;
    const ticket = ++requestRef.current;
    setLoading(true);
    const res = await listEvents(active, range.start, range.end, onUnauthorized);
    if (ticket !== requestRef.current) return;
    if (res.success && Array.isArray(res.data)) {
      setEvents(res.data);
      setBanner(null);
    } else {
      setEvents([]);
      if (!res.success) setBanner(res.message);
    }
    setLoading(false);
  }, [active, range.start, range.end, supported, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadInvitations = useCallback(async () => {
    if (supported !== true) return;
    const res = await listInvitations(onUnauthorized);
    if (res.success && Array.isArray(res.data)) setInvitations(res.data);
  }, [supported, onUnauthorized]);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  async function respond(invitation: Invitation, response: RsvpResponse) {
    setAnswering(invitation.id);
    const res = await sendRsvp(invitation.id, response, onUnauthorized);
    setAnswering(null);
    if (!res.success) {
      setBanner(res.message);
      return;
    }
    await Promise.all([loadInvitations(), load()]);
  }

  const readOnly = useMemo(() => calendars.find((c) => c.uri === active)?.read_only ?? false, [calendars, active]);

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
      view === 'week' ? addDays(current, 7 * direction) : direction === 1 ? addMonths(current, 1) : subMonths(current, 1),
    );
  }

  if (supported === null) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  if (supported === false) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <CalendarDays size={28} className="text-muted-foreground" />
        <h1 className="font-display text-base font-semibold">No calendar on this server</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This mail server does not run a calendar service, so there is nothing to show here. Mail is unaffected.
        </p>
        <a href="/" className="text-sm font-semibold text-primary underline">
          Back to mail
        </a>
      </div>
    );
  }

  const title =
    view === 'week'
      ? `${format(startOfWeek(anchor, WEEK_OPTS), 'd MMM')} – ${format(addDays(startOfWeek(anchor, WEEK_OPTS), 6), 'd MMM yyyy')}`
      : format(anchor, 'MMMM yyyy');

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-card">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-5">
        <IconButton label="Menu" size="sm" onClick={openMenu} className="md:hidden">
          <MenuIcon size={15} />
        </IconButton>
        <Button size="xs" onClick={() => setAnchor(new Date())}>
          Today
        </Button>
        <IconButton label="Previous" size="sm" onClick={() => step(-1)}>
          <ChevronLeft size={15} />
        </IconButton>
        <IconButton label="Next" size="sm" onClick={() => step(1)}>
          <ChevronRight size={15} />
        </IconButton>
        <h1 className="min-w-0 truncate px-1 font-display text-[15px] font-bold tracking-tight">{title}</h1>

        <div className="ml-auto flex items-center gap-2">
          {calendars.length > 1 && (
            <Select id="calendar-picker" value={active} onChange={(e) => setActive(e.target.value)} className="h-8 !w-auto py-0 text-[12.5px]">
              {calendars.map((calendar) => (
                <option key={calendar.uri} value={calendar.uri}>
                  {calendar.name}
                </option>
              ))}
            </Select>
          )}

          <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
            {(['month', 'week', 'agenda'] as ViewMode[]).map((mode) => (
              <FilterPill key={mode} active={view === mode} onClick={() => setView(mode)} className="capitalize">
                {mode}
              </FilterPill>
            ))}
          </div>

          <IconButton label="Subscription links" size="sm" onClick={() => router.push('/settings/calendar')}>
            <Link2 size={14} />
          </IconButton>

          {!readOnly && (
            <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => openNew(new Date(), false)}>
              New
            </Button>
          )}
        </div>
      </header>

      {!invitationsHidden && (
        <InvitationsPanel invitations={invitations} busy={answering} onRespond={respond} onDismiss={() => setInvitationsHidden(true)} />
      )}

      {banner && <p className="border-b border-border bg-warning/[0.12] px-4 py-2 text-sm text-warning">{banner}</p>}
      {readOnly && (
        <p className="border-b border-border bg-muted px-4 py-1.5 text-xs text-muted-foreground">
          This calendar is shared with you as read-only.
        </p>
      )}

      <main className="flex min-h-0 flex-1 flex-col">
        {/* The grid stays rendered while a range loads: a spinner would flash the whole screen. */}
        <div className={loading ? 'flex min-h-0 flex-1 flex-col opacity-60' : 'flex min-h-0 flex-1 flex-col'}>
          {view === 'month' && <MonthView events={events} anchor={anchor} onSelect={openExisting} onCreateAt={openNew} />}
          {view === 'week' && <WeekView events={events} anchor={anchor} onSelect={openExisting} onCreateAt={openNew} />}
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
          onUnauthorized={onUnauthorized}
        />
      )}
    </div>
  );
}
