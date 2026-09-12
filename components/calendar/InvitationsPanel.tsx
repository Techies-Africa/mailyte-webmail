'use client';

/**
 * Invitations waiting for an answer.
 *
 * Reads the CalDAV scheduling inbox -- the same collection Apple Calendar and
 * DAVx5 read -- so answering here and answering on a phone cannot disagree
 * about what is still outstanding. Answering sends a real iTIP REPLY to the
 * organizer; the server does that, not this component.
 */

import { useState } from 'react';
import { format } from 'date-fns';
import { Calendar, Check, HelpCircle, MapPin, X } from 'lucide-react';
import type { Invitation, RsvpResponse } from '@/lib/webmail/calendar';

type Props = {
  invitations: Invitation[];
  busy: string | null;
  onRespond: (invitation: Invitation, response: RsvpResponse) => void;
  onDismiss: () => void;
};

const CHOICES: { value: RsvpResponse; label: string; icon: typeof Check; tone: string }[] = [
  { value: 'accepted', label: 'Yes', icon: Check, tone: 'bg-teal-600 text-white' },
  {
    value: 'tentative',
    label: 'Maybe',
    icon: HelpCircle,
    tone: 'border border-neutral-300 dark:border-neutral-600',
  },
  {
    value: 'declined',
    label: 'No',
    icon: X,
    tone: 'border border-neutral-300 dark:border-neutral-600',
  },
];

export default function InvitationsPanel({ invitations, busy, onRespond, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(true);

  if (invitations.length === 0) return null;

  return (
    <section className="border-b border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/25">
      <div className="flex items-center justify-between px-4 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200"
        >
          <Calendar size={15} />
          {invitations.length === 1
            ? '1 invitation needs an answer'
            : `${invitations.length} invitations need an answer`}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-amber-800 underline dark:text-amber-300"
        >
          Hide
        </button>
      </div>

      {expanded && (
        <ul className="space-y-2 px-4 pb-3">
          {invitations.map((invitation) => {
            const start = new Date(invitation.start);
            const end = invitation.end ? new Date(invitation.end) : null;
            const working = busy === invitation.id;
            // A CANCEL is not something to RSVP to -- the organizer called it
            // off. Offering Yes/Maybe/No there would be nonsense.
            const cancelled = invitation.method === 'CANCEL';

            return (
              <li
                key={invitation.id}
                className="rounded border border-amber-200 bg-white p-3 dark:border-amber-900/60 dark:bg-neutral-900"
              >
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">
                    {cancelled ? 'Cancelled: ' : ''}
                    {invitation.summary ?? 'Untitled'}
                  </span>
                  {invitation.organizer && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      from {invitation.organizer.name ?? invitation.organizer.email}
                    </span>
                  )}
                </div>

                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
                  <span className="tabular-nums">
                    {invitation.all_day
                      ? format(start, 'EEE d MMM yyyy')
                      : `${format(start, 'EEE d MMM, HH:mm')}${end ? `–${format(end, 'HH:mm')}` : ''}`}
                  </span>
                  {invitation.location && (
                    <span className="flex items-center gap-1">
                      <MapPin size={11} /> {invitation.location}
                    </span>
                  )}
                  {invitation.recurring && <span>Repeats</span>}
                </div>

                {cancelled ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => onRespond(invitation, 'declined')}
                    className="rounded border border-neutral-300 px-3 py-1 text-xs disabled:opacity-50 dark:border-neutral-600"
                  >
                    {working ? 'Removing…' : 'Remove from my calendar'}
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {CHOICES.map(({ value, label, icon: Icon, tone }) => (
                      <button
                        key={value}
                        type="button"
                        disabled={working}
                        onClick={() => onRespond(invitation, value)}
                        className={`flex items-center gap-1 rounded px-3 py-1 text-xs disabled:opacity-50 ${tone}`}
                      >
                        <Icon size={12} /> {label}
                      </button>
                    ))}
                    {working && (
                      <span className="text-xs text-neutral-500">Sending your answer…</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
