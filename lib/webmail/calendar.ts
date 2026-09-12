// Calendar types and API calls.
//
// Mirrors lib/webmail/client.ts: every call can come back 401 when the session
// has expired, so callers pass onUnauthorized and the page redirects once, in
// one place.
//
// Dates cross this boundary as ISO strings, never as Date objects. The server
// is the authority on what a time means -- it holds the TZID and the
// VTIMEZONE -- and reconstructing that in the browser from a timestamp loses
// the wall-clock intent that recurring events depend on.

import type { ApiResult } from './client';

export type CalendarSummary = {
  uri: string;
  name: string;
  color: string | null;
  description: string | null;
  read_only: boolean;
  is_default: boolean;
};

export type EventAttendee = {
  email: string;
  name: string | null;
  status: string;
  role: string;
  rsvp: boolean;
  /**
   * Set by the server's scheduling plugin. `1.x` delivered, `3.7` unknown
   * user, `5.x` could not be delivered.
   *
   * Rendered rather than hidden on purpose. Delivery is real in both
   * directions now, but it can still fail -- the server may not be able to
   * reach an address, or iMIP may be off on this deployment -- and an
   * undelivered invitation that looks sent is the failure this whole feature
   * exists to avoid.
   */
  schedule_status: string | null;
};

export type CalendarEvent = {
  id: string;
  etag: string;
  calendar: string;
  uid: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  status: string | null;
  start: string;
  end: string | null;
  timezone: string | null;
  all_day: boolean;
  recurring: boolean;
  rrule: string | null;
  sequence: number;
  organizer: { email: string; name: string | null } | null;
  attendees: EventAttendee[];
  alarms: number;
};

export type EventDraft = {
  summary: string;
  start: string;
  end: string;
  timezone_id?: string | null;
  all_day?: boolean;
  description?: string | null;
  location?: string | null;
  rrule?: string | null;
  reminder_minutes?: number | null;
  attendees?: { email: string; name?: string | null }[];
};

export type SubscriptionLink = {
  token: string;
  calendar_uri: string;
  label: string | null;
  url: string | null;
  webcal_url: string | null;
  created_at: string | null;
  last_accessed_at: string | null;
};

async function call<T>(
  input: string,
  init: RequestInit | undefined,
  onUnauthorized: () => void,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { success: false, message: 'Could not reach the mail server. Check your connection.' };
  }

  if (res.status === 401) {
    onUnauthorized();
    return { success: false, message: 'Not logged in' };
  }

  // 501 is "this deployment has no calendar service" -- a supported
  // configuration, not a fault. The nav entry is gated on the capability so
  // this should be unreachable, but saying it plainly beats a generic error.
  if (res.status === 501) {
    return { success: false, message: 'This server does not provide a calendar.' };
  }

  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    type?: string;
    message?: string;
    msg?: string;
    data?: T;
  };

  const ok = data.success === true || data.type === 'success';
  if (!ok) {
    return {
      success: false,
      message: data.message ?? data.msg ?? 'Something went wrong. Please try again.',
    };
  }
  return { success: true, data: data.data as T };
}

export function listCalendars(onUnauthorized: () => void) {
  return call<CalendarSummary[]>('/api/webmail/calendar/calendars', undefined, onUnauthorized);
}

export function listEvents(
  calendar: string,
  start: Date,
  end: Date,
  onUnauthorized: () => void,
) {
  const query = new URLSearchParams({
    calendar,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  return call<CalendarEvent[]>(
    `/api/webmail/calendar/events?${query}`,
    undefined,
    onUnauthorized,
  );
}

export function createEvent(calendar: string, draft: EventDraft, onUnauthorized: () => void) {
  return call<{ id: string; etag: string }>(
    `/api/webmail/calendar/events?calendar=${encodeURIComponent(calendar)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    },
    onUnauthorized,
  );
}

export function updateEvent(
  calendar: string,
  id: string,
  etag: string,
  draft: EventDraft,
  onUnauthorized: () => void,
) {
  const query = new URLSearchParams({ calendar, etag });
  return call<{ id: string; etag: string }>(
    `/api/webmail/calendar/events/${encodeURIComponent(id)}?${query}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    },
    onUnauthorized,
  );
}

export function deleteEvent(
  calendar: string,
  id: string,
  etag: string,
  onUnauthorized: () => void,
) {
  const query = new URLSearchParams({ calendar, etag });
  return call<null>(
    `/api/webmail/calendar/events/${encodeURIComponent(id)}?${query}`,
    { method: 'DELETE' },
    onUnauthorized,
  );
}

export function listSubscriptions(onUnauthorized: () => void) {
  return call<SubscriptionLink[]>(
    '/api/webmail/calendar/subscriptions',
    undefined,
    onUnauthorized,
  );
}

export function createSubscription(
  calendar: string,
  label: string | null,
  onUnauthorized: () => void,
) {
  return call<SubscriptionLink>(
    '/api/webmail/calendar/subscriptions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendar, label }),
    },
    onUnauthorized,
  );
}

export function revokeSubscription(token: string, onUnauthorized: () => void) {
  return call<null>(
    `/api/webmail/calendar/subscriptions/${encodeURIComponent(token)}`,
    { method: 'DELETE' },
    onUnauthorized,
  );
}

/**
 * Whether an attendee's invitation actually went anywhere.
 *
 * iTIP request-status codes are `class.subclass;text`. 1.x is delivered, 2.x
 * is success with a caveat, 3.x is a client problem (3.7 being "no such
 * user"), 5.x is the server saying it could not deliver at all.
 */
export function deliveryState(
  status: string | null,
): 'delivered' | 'undelivered' | 'unknown' {
  if (!status) return 'unknown';
  const code = status.split(';')[0]?.trim() ?? '';
  if (code.startsWith('1') || code.startsWith('2')) return 'delivered';
  if (code.startsWith('3') || code.startsWith('4') || code.startsWith('5')) return 'undelivered';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Scheduling: invitations, RSVP, availability
// ---------------------------------------------------------------------------

export type Invitation = CalendarEvent & {
  /** REQUEST, CANCEL or REPLY. What the organizer is telling you. */
  method: string | null;
};

export type RsvpResponse = 'accepted' | 'declined' | 'tentative';

export type Availability = {
  email: string;
  /**
   * Whether the server could answer for this person at all.
   *
   * False for anyone outside the organization -- neither Google nor Microsoft
   * exposes free/busy to strangers. A UI must render this as "unknown", never
   * as "free": showing someone as available when nobody asked them is how a
   * meeting gets booked over a conflict.
   */
  known: boolean;
  busy: { start: string; end: string }[];
};

export function listInvitations(onUnauthorized: () => void) {
  return call<Invitation[]>('/api/webmail/calendar/invitations', undefined, onUnauthorized);
}

export function rsvp(id: string, response: RsvpResponse, onUnauthorized: () => void) {
  return call<{ id: string; response: string }>(
    `/api/webmail/calendar/invitations/${encodeURIComponent(id)}/rsvp`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    },
    onUnauthorized,
  );
}

export function checkAvailability(
  attendees: string[],
  start: Date,
  end: Date,
  onUnauthorized: () => void,
) {
  return call<Availability[]>(
    '/api/webmail/calendar/free-busy',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendees,
        start: start.toISOString(),
        end: end.toISOString(),
      }),
    },
    onUnauthorized,
  );
}

/** Whether a busy period overlaps the proposed slot. */
export function clashes(availability: Availability, start: Date, end: Date): boolean {
  if (!availability.known) return false;
  const from = start.getTime();
  const to = end.getTime();
  return availability.busy.some((period) => {
    const busyFrom = new Date(period.start).getTime();
    const busyTo = new Date(period.end).getTime();
    return busyFrom < to && from < busyTo;
  });
}
