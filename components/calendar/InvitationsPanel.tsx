'use client';

/**
 * Invitations waiting for an answer.
 *
 * Reads the CalDAV scheduling inbox -- the same collection Apple Calendar and
 * DAVx5 read -- so answering here and answering on a phone cannot disagree
 * about what is still outstanding. Answering sends a real iTIP REPLY to the
 * organizer; the server does that, not this component.
 *
 * Cards share the row and every row is filled: one invitation takes the full
 * width, two split it. As a stack of full-width cards, each kept its title
 * and buttons at the left edge of a wide screen and left the rest empty.
 */

import { useId, useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { CalendarClock, Check, ChevronDown, CircleHelp, Clock, MapPin, Repeat, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import type { Invitation, RsvpResponse } from '@/lib/webmail/calendar';

type Props = {
  invitations: Invitation[];
  busy: string | null;
  onRespond: (invitation: Invitation, response: RsvpResponse) => void;
  onDismiss: () => void;
};

/** The answers, as one segmented control. Only the icons carry colour. */
const CHOICES: { value: RsvpResponse; label: string; icon: typeof Check; tone: string }[] = [
  { value: 'accepted', label: 'Yes', icon: Check, tone: 'text-success' },
  { value: 'tentative', label: 'Maybe', icon: CircleHelp, tone: 'text-muted-foreground' },
  { value: 'declined', label: 'No', icon: X, tone: 'text-destructive' },
];

/** When, beside the date tile: "10:00 – 15:00", "All day", or across days. */
function when(invitation: Invitation): string {
  const start = new Date(invitation.start);
  const end = invitation.end ? new Date(invitation.end) : null;
  if (invitation.all_day) {
    return end && !isSameDay(start, end) ? `All day · until ${format(end, 'EEE d MMM')}` : 'All day';
  }
  if (!end) return format(start, 'HH:mm');
  return isSameDay(start, end)
    ? `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')}`
    : `${format(start, 'HH:mm')} – ${format(end, 'EEE d MMM, HH:mm')}`;
}

export default function InvitationsPanel({ invitations, busy, onRespond, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(true);
  const listId = useId();

  if (invitations.length === 0) return null;

  const count =
    invitations.length === 1 ? '1 invitation needs an answer' : `${invitations.length} invitations need an answer`;

  return (
    <section aria-label="Invitations" className="shrink-0 border-b border-border bg-pane">
      <div className="flex items-center gap-2 px-3 py-2 sm:px-5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
          className="-ml-1 flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-foreground/[0.05]"
        >
          <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarClock size={15} />
          </span>
          <span className="truncate text-[13px] font-semibold text-foreground">{count}</span>
          <ChevronDown
            aria-hidden
            size={14}
            strokeWidth={2.2}
            className={['shrink-0 text-muted-foreground transition-transform', expanded ? 'rotate-180' : ''].join(' ')}
          />
        </button>
        <Button variant="ghost" size="xs" onClick={onDismiss} className="ml-auto">
          Hide
        </Button>
      </div>

      {expanded && (
        <ul id={listId} className="thin-scroll flex max-h-[min(22rem,40dvh)] flex-wrap gap-2.5 overflow-y-auto px-3 pb-3 sm:px-5">
          {invitations.map((invitation) => {
            const start = new Date(invitation.start);
            const working = busy === invitation.id;
            // A CANCEL is not something to RSVP to -- the organizer called it
            // off. Offering Yes/Maybe/No there would be nonsense.
            const cancelled = invitation.method === 'CANCEL';
            const title = invitation.summary ?? 'Untitled';
            const organizer = invitation.organizer;

            return (
              <li
                key={invitation.id}
                className="flex min-w-0 flex-[1_1_20rem] gap-3 rounded-xl border border-border bg-card p-3 shadow-sm"
              >
                <div aria-hidden className="flex w-12 shrink-0 flex-col items-center justify-center self-start rounded-lg bg-primary/10 py-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">{format(start, 'MMM')}</span>
                  <span className="font-display text-xl font-bold leading-6 text-foreground">{format(start, 'd')}</span>
                  <span className="text-[10px] font-medium text-muted-foreground">{format(start, 'EEE')}</span>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2.5">
                  <div className="min-w-0 flex-1 basis-52">
                    <p className="truncate text-[13.5px] font-semibold text-foreground" title={title}>
                      {cancelled && <span className="text-destructive">Cancelled: </span>}
                      {title}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Clock size={12} aria-hidden />
                        {when(invitation)}
                      </span>
                      {invitation.location && (
                        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                          <MapPin size={12} aria-hidden className="shrink-0" />
                          <span className="truncate">{invitation.location}</span>
                        </span>
                      )}
                      {invitation.recurring && (
                        <span className="inline-flex items-center gap-1">
                          <Repeat size={12} aria-hidden />
                          Repeats
                        </span>
                      )}
                    </p>
                    {organizer && (
                      <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <Avatar name={organizer.name ?? organizer.email} email={organizer.email} size={18} />
                        <span className="truncate">
                          From <span className="font-medium text-foreground">{organizer.name ?? organizer.email}</span>
                        </span>
                      </p>
                    )}
                  </div>

                  {cancelled ? (
                    <Button size="sm" busy={working} onClick={() => onRespond(invitation, 'declined')}>
                      {working ? 'Removing…' : 'Remove from my calendar'}
                    </Button>
                  ) : working ? (
                    <span role="status" className="inline-flex h-8 items-center gap-2 text-xs text-muted-foreground">
                      <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Sending your answer…
                    </span>
                  ) : (
                    <div
                      role="group"
                      aria-label={`Reply to ${title}`}
                      className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border bg-background"
                    >
                      {CHOICES.map(({ value, label, icon: Icon, tone }, index) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => onRespond(invitation, value)}
                          className={[
                            'inline-flex h-8 items-center gap-1.5 px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted',
                            index > 0 ? 'border-l border-border' : '',
                          ].join(' ')}
                        >
                          <Icon aria-hidden size={13} strokeWidth={2.4} className={tone} />
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
