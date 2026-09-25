'use client';

/**
 * The calendar screen.
 *
 * Gated on the server's `calendar` capability, like every other optional
 * feature: a deployment without the DAV service renders no calendar at all
 * rather than a screen whose every action fails.
 */

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, addMonths, endOfMonth, endOfWeek, format, isValid, parseISO, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Link2, Menu as MenuIcon, Plus } from 'lucide-react';
import { AgendaView, MonthView, WeekView, type ViewMode } from '@/components/calendar/CalendarViews';
import EventModal from '@/components/calendar/EventModal';
import InvitationsPanel from '@/components/calendar/InvitationsPanel';
import PageShell, { pageMenuButtonProps, usePageMenu } from '@/components/webmail/shell/PageShell';
import { useCapabilities } from '@/lib/webmail/query/accountQueries';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import { FilterPill } from '@/components/ui/Pill';
import SelectMenu, { Swatch, type SelectMenuOption } from '@/components/ui/SelectMenu';
import {
  calendarColour,
  createEvent,
  deleteEvent,
  rsvp as sendRsvp,
  updateEvent,
  type CalendarEvent,
  type CalendarSummary,
  type EventDraft,
  type Invitation,
  type RsvpResponse,
} from '@/lib/webmail/calendar';
import {
  calendarKeys,
  pickDefaultCalendar,
  prefetchEvents,
  useCalendars,
  useEvents,
  useInvitations,
} from '@/lib/webmail/query/calendarQueries';
import { useUnauthorizedHandler } from '@/lib/webmail/query/session';
import { CALENDAR_CHOICE_KEY, useRememberedChoice } from '@/lib/webmail/useRememberedChoice';
import { useIsMobile } from '@/lib/webmail/useIsMobile';

const WEEK_OPTS = { weekStartsOn: 1 as const };

/** `/calendar?date=2026-09-24` opens on that day (the inbox's mini calendar links here); no date is today. */
function anchorFor(raw: string | null): Date {
  if (!raw) return new Date();
  const parsed = parseISO(raw);
  return isValid(parsed) ? parsed : new Date();
}

/**
 * The range on screen. Month view shows leading and trailing days from the
 * neighbouring months, so the query covers the whole grid.
 */
function rangeFor(anchor: Date, view: ViewMode): { start: Date; end: Date } {
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
}

/** Where Previous and Next go from here. */
function stepAnchor(anchor: Date, view: ViewMode, direction: -1 | 1): Date {
  if (view === 'week') return addDays(anchor, 7 * direction);
  return direction === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1);
}

/** Now, rounded up to the next half hour: where "New" starts an event, as Google Calendar does (not 04:28). */
function nextHalfHour(): Date {
  const at = new Date();
  at.setMinutes(Math.ceil(at.getMinutes() / 30) * 30, 0, 0);
  return at;
}

const NO_CALENDARS: CalendarSummary[] = [];
const NO_EVENTS: CalendarEvent[] = [];
const NO_INVITATIONS: Invitation[] = [];

export default function CalendarPage() {
  // Null until the server has answered once; cached after that, so a revisit gates at once.
  const capabilities = useCapabilities().data;
  const supported = capabilities ? capabilities.capabilities?.calendar === true : null;
  return (
    <PageShell current="calendar">
      {/* useSearchParams below needs a boundary to render statically. */}
      <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
        <CalendarScreen supported={supported} email={capabilities?.email_address ?? null} />
      </Suspense>
    </PageShell>
  );
}

function CalendarScreen({ supported, email }: { supported: boolean | null; email: string | null }) {
  const router = useRouter();
  const [menuOpen, openMenu] = usePageMenu();
  const queryClient = useQueryClient();
  const onUnauthorized = useUnauthorizedHandler();

  // The calendars, cached and shared with the inbox's calendar panel. The one
  // shown is the one last picked in this mailbox, else the server's default --
  // both known before any events are asked for (the remembered pick is
  // undefined until storage has been read), so entering the screen fetches
  // events once, not twice.
  const calendarsResult = useCalendars(supported === true);
  const calendars = calendarsResult.data ?? NO_CALENDARS;
  const [remembered, remember] = useRememberedChoice(CALENDAR_CHOICE_KEY, email);
  const active = remembered === undefined ? null : pickDefaultCalendar(calendarsResult.data, remembered);

  // A view picked by hand is kept; until then a phone opens on the agenda,
  // where a month's seven columns are 50px each and a week's are 43px.
  const isMobile = useIsMobile();
  const [pickedView, setView] = useState<ViewMode | null>(null);
  const view: ViewMode = pickedView ?? (isMobile ? 'agenda' : 'month');
  // The day comes from the address. Read through the router, not
  // window.location: a client-side arrival renders before the address bar
  // changes. A link to the calendar while it is already open -- a day in the
  // inbox panel, the rail's Calendar row -- changes only the query, so it is
  // followed here too.
  const dateParam = useSearchParams().get('date');
  const [anchor, setAnchor] = useState(() => anchorFor(dateParam));
  const [followedParam, setFollowedParam] = useState(dateParam);
  if (dateParam !== followedParam) {
    setFollowedParam(dateParam);
    setAnchor(anchorFor(dateParam));
  }

  /** What went wrong with the last thing the person did. Load failures come from the queries. */
  const [actionError, setBanner] = useState<string | null>(null);

  const [invitationsHidden, setInvitationsHidden] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);

  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creatingAt, setCreatingAt] = useState<{ start: Date; allDay: boolean } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const range = useMemo(() => rangeFor(anchor, view), [anchor, view]);
  const eventsResult = useEvents(active, range.start, range.end, supported === true);
  const events = eventsResult.data ?? NO_EVENTS;
  // Dimmed while another range stands in for this one; a range seen before shows at once.
  const loading = eventsResult.isPlaceholderData || (eventsResult.isPending && eventsResult.fetchStatus === 'fetching');
  const banner =
    actionError ??
    (eventsResult.isError ? eventsResult.error.message : null) ??
    (calendarsResult.isError ? calendarsResult.error.message : null);

  // The ranges either side, fetched once this one is in, so Previous and Next are instant.
  const settled = !eventsResult.isFetching;
  useEffect(() => {
    if (!active || supported !== true || !settled) return;
    for (const direction of [-1, 1] as const) {
      const next = rangeFor(stepAnchor(anchor, view, direction), view);
      prefetchEvents(queryClient, active, next.start, next.end, onUnauthorized);
    }
  }, [active, supported, settled, anchor, view, queryClient, onUnauthorized]);

  const invitations = useInvitations(supported === true).data ?? NO_INVITATIONS;

  /**
   * An answer takes the invitation off the list at once; a refusal puts that
   * one back -- only that one, so another answered meanwhile is not revived
   * and answered twice -- and the server's list follows.
   */
  async function respond(invitation: Invitation, response: RsvpResponse) {
    setAnswering(invitation.id);
    queryClient.setQueryData<Invitation[]>(calendarKeys.invitations, (list) => list?.filter((i) => i.id !== invitation.id));
    const res = await sendRsvp(invitation.id, response, onUnauthorized);
    setAnswering(null);
    if (!res.success) {
      queryClient.setQueryData<Invitation[]>(calendarKeys.invitations, (list) =>
        list && !list.some((i) => i.id === invitation.id) ? [...list, invitation] : list,
      );
      void queryClient.invalidateQueries({ queryKey: calendarKeys.invitations });
      setBanner(res.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: calendarKeys.invitations });
    void queryClient.invalidateQueries({ queryKey: calendarKeys.events });
  }

  const activeCalendar = useMemo(() => calendars.find((c) => c.uri === active) ?? null, [calendars, active]);
  const readOnly = activeCalendar?.read_only ?? false;
  // The grid's events wear this calendar's own colour -- the swatch its
  // picker row shows. Null: the accent.
  const colour = activeCalendar ? calendarColour(activeCalendar) : null;
  const calendarOptions = useMemo<SelectMenuOption[]>(
    () =>
      calendars.map((c) => ({
        value: c.uri,
        label: c.name || c.uri,
        description: c.description,
        readOnly: c.read_only,
        leading: <Swatch colour={calendarColour(c)} />,
      })),
    [calendars],
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

  /**
   * Saving waits for the server, inside the dialog: it can refuse (a changed
   * etag, a bad date) and it sends the invitations. Once it says yes the
   * dialog closes and the grid refreshes behind it, without blanking.
   */
  async function save(draft: EventDraft) {
    if (!active) return;
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
    setBanner(null);
    void queryClient.invalidateQueries({ queryKey: calendarKeys.events });
  }

  /** Deleting (after the dialog's own confirm) takes the event off every cached range at once. */
  function remove() {
    if (!editing || !active) return;
    const target = editing;
    const calendar = active;
    setModalOpen(false);
    queryClient.setQueriesData<CalendarEvent[]>({ queryKey: calendarKeys.events }, (list) =>
      list?.filter((e) => e.id !== target.id),
    );
    void (async () => {
      const res = await deleteEvent(calendar, target.id, target.etag, onUnauthorized);
      // Refused or not, the server's ranges follow: a refusal brings the event
      // back without reviving anything else deleted meanwhile.
      if (!res.success) setBanner(`Couldn't delete "${target.summary ?? 'that event'}": ${res.message}`);
      void queryClient.invalidateQueries({ queryKey: calendarKeys.events });
    })();
  }

  function step(direction: -1 | 1) {
    setAnchor((current) => stepAnchor(current, view, direction));
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
        <Link href="/" className="text-sm font-semibold text-primary underline">
          Back to mail
        </Link>
      </div>
    );
  }

  const title =
    view === 'week'
      ? `${format(startOfWeek(anchor, WEEK_OPTS), 'd MMM')} – ${format(addDays(startOfWeek(anchor, WEEK_OPTS), 6), 'd MMM yyyy')}`
      : format(anchor, 'MMMM yyyy');
  // The same, short enough to share a phone's first header row.
  const shortTitle =
    view === 'week'
      ? `${format(startOfWeek(anchor, WEEK_OPTS), 'd MMM')} – ${format(addDays(startOfWeek(anchor, WEEK_OPTS), 6), 'd MMM')}`
      : format(anchor, 'MMM yyyy');

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-card">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-5">
        <IconButton label="Menu" size="sm" onClick={openMenu} {...pageMenuButtonProps(menuOpen)} className="md:hidden">
          <MenuIcon size={15} />
        </IconButton>
        <Button size="sm" onClick={() => setAnchor(new Date())}>
          Today
        </Button>
        <IconButton label="Previous" size="md" onClick={() => step(-1)}>
          <ChevronLeft size={17} />
        </IconButton>
        <IconButton label="Next" size="md" onClick={() => step(1)}>
          <ChevronRight size={17} />
        </IconButton>
        <h1 className="min-w-0 truncate px-1 font-display text-[17px] font-semibold tracking-tight sm:text-xl">
          <span className="sm:hidden">{shortTitle}</span>
          <span className="hidden sm:inline">{title}</span>
        </h1>

        {/* Wraps onto a second row on a phone rather than running off it. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {calendars.length > 1 && active && (
            <SelectMenu label="Calendar" heading="Calendars" options={calendarOptions} value={active} onChange={remember} compact />
          )}

          {/* After Hide, the invitations are one click away rather than gone until a reload. */}
          {invitationsHidden && invitations.length > 0 && (
            <IconButton
              label={invitations.length === 1 ? 'Show 1 invitation' : `Show ${invitations.length} invitations`}
              size="md"
              onClick={() => setInvitationsHidden(false)}
              className="relative"
            >
              <CalendarClock size={16} />
              <span
                aria-hidden
                className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[9.5px] font-bold leading-none text-primary-foreground"
              >
                {invitations.length}
              </span>
            </IconButton>
          )}

          <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
            {(['month', 'week', 'agenda'] as ViewMode[]).map((mode) => (
              <FilterPill key={mode} active={view === mode} onClick={() => setView(mode)} className="capitalize">
                {mode}
              </FilterPill>
            ))}
          </div>

          {/* Not on a phone, where it crowded the header; Settings has it. */}
          <IconButton
            label="Subscription links"
            size="sm"
            onClick={() => router.push('/settings/calendar')}
            className="hidden sm:inline-flex"
          >
            <Link2 size={14} />
          </IconButton>

          {!readOnly && (
            <Button variant="primary" size="sm" icon={<Plus size={13} />} collapseLabel onClick={() => openNew(nextHalfHour(), false)}>
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
          {view === 'month' && <MonthView events={events} anchor={anchor} colour={colour} onSelect={openExisting} onCreateAt={openNew} />}
          {view === 'week' && <WeekView events={events} anchor={anchor} colour={colour} onSelect={openExisting} onCreateAt={openNew} />}
          {view === 'agenda' && (
            <AgendaView
              events={events}
              colour={colour}
              onSelect={openExisting}
              onCreate={readOnly ? undefined : () => openNew(nextHalfHour(), false)}
            />
          )}
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
          calendarName={activeCalendar ? activeCalendar.name || activeCalendar.uri : null}
          colour={colour}
          onClose={() => setModalOpen(false)}
          onSave={save}
          onDelete={remove}
          onUnauthorized={onUnauthorized}
        />
      )}
    </div>
  );
}
