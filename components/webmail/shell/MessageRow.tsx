'use client';

import { useEffect, useRef } from 'react';
import { Archive, CornerUpLeft, Paperclip, Star, Trash2, X } from 'lucide-react';
import { differenceInCalendarDays, format, isThisYear, isToday, isValid } from 'date-fns';
import type { WebmailListItem } from '../types';
import Avatar from '@/components/ui/Avatar';
import { Tag } from '@/components/ui/Pill';
import { rowTags } from '@/lib/webmail/tags';

/**
 * What a mail client shows: the time if it arrived today, the weekday if it
 * arrived this week, otherwise a date. Tolerates an invalid Date -- date-fns'
 * format() throws on one, and a malformed header must not take the list down.
 */
export function listDate(date: Date): string {
  if (!isValid(date)) return '';
  if (isToday(date)) return format(date, 'HH:mm');
  if (differenceInCalendarDays(new Date(), date) < 7) return format(date, 'EEE');
  if (isThisYear(date)) return format(date, 'd MMM');
  return format(date, 'dd/MM/yy');
}

type MessageRowProps = {
  email: WebmailListItem;
  selected: boolean;
  /** This row is the one open in the reading pane. */
  open: boolean;
  density: 'comfortable' | 'compact';
  /** Set when the row is a scheduled message: the date column shows when it goes. */
  scheduled?: { label: string; failed: boolean; error: string | null };
  /** The folder name is shown as a tag when results span folders. */
  showFolder: boolean;
  /** Work out an automatic tag from the sender and subject (off in Sent and Drafts). */
  autoTags: boolean;
  onOpen: () => void;
  /** The pointer has settled on the row: a good moment to fetch its body. */
  onHover?: () => void;
  onSelect: (selected: boolean) => void;
  onStar: () => void;
  onArchive?: () => void;
  onTrash: () => void;
  onCancelScheduled?: () => void;
};

const HOVER_INTENT_MS = 120;

// Revealed on hover, so they exist only where there is a hover (can-hover):
// on touch they were invisible but still took taps, and a tap under a row's
// date could archive or bin a message nobody saw a button for. There the
// open message's toolbar, the bulk bar and the keyboard (e, #, s) have them.
const ACTION =
  'hidden h-6 w-6 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground can-hover:inline-flex can-hover:opacity-0 can-hover:focus-visible:opacity-100 can-hover:group-hover:opacity-100';

export default function MessageRow({
  email,
  selected,
  open,
  density,
  scheduled,
  showFolder,
  autoTags,
  onOpen,
  onHover,
  onSelect,
  onStar,
  onArchive,
  onTrash,
  onCancelScheduled,
}: MessageRowProps) {
  const unread = !email.isRead;
  const compact = density === 'compact';

  const tags: { key: string; label: string; tone: 'neutral' | 'primary' | 'warning' | 'danger' | 'success' }[] = [];
  if (email.isDraft) tags.push({ key: 'draft', label: 'Draft', tone: 'warning' });
  if (scheduled) {
    tags.push(
      scheduled.failed
        ? { key: 'failed', label: 'Did not send', tone: 'danger' }
        : { key: 'scheduled', label: `Sends ${scheduled.label}`, tone: 'primary' },
    );
  }
  if (showFolder && email.folder) {
    tags.push({
      key: 'folder',
      label: email.folder === 'INBOX' ? 'Inbox' : email.folder.replace(/^Shared\//, ''),
      tone: 'neutral',
    });
  }
  // The person's labels, then one automatic tag read off the message itself.
  for (const tag of rowTags(email, { auto: autoTags && !email.isDraft })) tags.push(tag);

  // Only a pointer that stays a moment counts; one sweeping past fetches nothing.
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => cancelHover, []);

  const stop = (e: React.MouseEvent, fn?: () => void) => {
    e.stopPropagation();
    fn?.();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={open ? 'true' : undefined}
      onClick={onOpen}
      onMouseEnter={
        onHover
          ? () => {
              cancelHover();
              hoverTimer.current = setTimeout(onHover, HOVER_INTENT_MS);
            }
          : undefined
      }
      onMouseLeave={cancelHover}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={[
        'group cursor-pointer border-b border-border/70 transition-colors',
        open || selected ? 'bg-selection' : unread ? 'bg-card hover:bg-selection/60' : 'bg-pane hover:bg-selection/60',
      ].join(' ')}
    >
      <div className={`flex items-start gap-2 pl-3 pr-2.5 ${compact ? 'py-1.5' : 'pb-2 pt-2.5'}`}>
        {/* Checkbox above the unread dot, the way the redesign stacks them. */}
        <div className="flex w-[18px] shrink-0 flex-col items-center gap-1.5 pt-0.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select "${email.subject}"`}
            className="h-[13px] w-[13px] cursor-pointer rounded accent-primary"
          />
          <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`} />
        </div>

        <Avatar name={email.from} email={email.fromEmail} size={compact ? 22 : 26} className="mt-0.5" />

        <div className="min-w-0 flex-1">
          <div
            title={email.fromEmail || email.from}
            className={`truncate text-[12.5px] ${unread ? 'font-bold text-foreground' : 'font-semibold text-foreground/70'}`}
          >
            {email.from}
          </div>
          <div className={`truncate text-[12px] ${unread ? 'font-bold text-foreground' : 'font-medium text-foreground/80'}`}>
            {email.isAnswered && (
              <CornerUpLeft size={12} className="-mt-0.5 mr-1 inline-block text-muted-foreground" aria-label="Replied" />
            )}
            {email.subject}
          </div>
          {!compact && email.preview && (
            <div className="mt-px truncate text-[11.5px] text-muted-foreground">{email.preview}</div>
          )}
          {tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Tag key={tag.key} tone={tag.tone} className={tag.key.startsWith('auto:') ? 'opacity-80' : ''}>
                  {tag.label}
                </Tag>
              ))}
            </div>
          )}
        </div>

        {/* Right column: the time, and under it the actions. Archive and
            Trash appear on hover (with a mouse only); the star stays once
            set. In the flow, not floated over the text, so a long subject
            truncates before it. */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="flex items-center gap-1 text-[10.5px] tabular-nums text-muted-foreground">
            {email.hasAttachment && <Paperclip size={11} aria-label="Has attachment" />}
            {scheduled ? (
              <span className={scheduled.failed ? 'text-destructive' : 'text-primary'}>
                {scheduled.failed ? 'Failed' : listDate(email.timestamp)}
              </span>
            ) : (
              listDate(email.timestamp)
            )}
          </span>
          <span className="flex items-center gap-0.5">
            {scheduled && onCancelScheduled ? (
              // Archive and Trash are deliberately not offered on a scheduled
              // message: moving it out of Scheduled cancels the send, and
              // doing that under a button labelled "Archive" would be silent.
              <button
                type="button"
                onClick={(e) => stop(e, onCancelScheduled)}
                title="Cancel send and move to Drafts"
                className="hidden h-6 items-center gap-1 rounded px-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground can-hover:inline-flex can-hover:opacity-0 can-hover:focus-visible:opacity-100 can-hover:group-hover:opacity-100"
              >
                <X size={12} /> Cancel send
              </button>
            ) : (
              <>
                {onArchive && (
                  <button type="button" onClick={(e) => stop(e, onArchive)} title="Archive" aria-label="Archive" className={ACTION}>
                    <Archive size={13} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => stop(e, onTrash)}
                  title="Move to Trash"
                  aria-label="Move to Trash"
                  className={`${ACTION} hover:!bg-destructive/10 hover:!text-destructive`}
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={(e) => stop(e, onStar)}
              title={email.isStarred ? 'Unstar' : 'Star'}
              aria-label={email.isStarred ? 'Unstar' : 'Star'}
              className={`h-6 w-6 items-center justify-center rounded transition-[opacity,transform] hover:scale-110 ${
                email.isStarred
                  ? 'inline-flex text-[hsl(38,85%,55%)] opacity-100'
                  : 'hidden text-muted-foreground hover:text-[hsl(38,85%,55%)] can-hover:inline-flex can-hover:opacity-0 can-hover:focus-visible:opacity-100 can-hover:group-hover:opacity-100'
              }`}
            >
              <Star size={13} className={email.isStarred ? 'fill-current' : ''} />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
