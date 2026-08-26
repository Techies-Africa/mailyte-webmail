import { useState } from 'react';
import { Star, Paperclip, Archive, Trash2, CornerUpLeft, FileEdit } from 'lucide-react';
import { differenceInCalendarDays, format, isThisYear, isToday } from 'date-fns';
import type { WebmailListItem } from './types';

/**
 * The message list.
 *
 * The layout is one line per message on a real screen, because that is what
 * makes a list scannable: every row has the same three columns at the same
 * baseline, so the eye runs down the sender column, or down the date column,
 * without re-finding them on each row.
 *
 * The previous version stacked subject over preview and put the sender in a
 * narrow fixed column beside that two-line block. Nothing shared a baseline,
 * rows were ~60px tall, and the sender column was so tight that almost every
 * name truncated ("Mail Delivery Syste…", "julietna67@gmail.c…") -- which is
 * the "everything is clustered" feeling: three type sizes, three baselines,
 * no grid.
 *
 * Under `md` there is not enough width for three columns, so it becomes a
 * deliberate two-line card instead of a squeezed version of the wide layout.
 */

type Density = 'comfortable' | 'compact';

type WebmailListProps = {
  emails: WebmailListItem[];
  selectedIds: string[];
  onSelectEmail: (id: string, selected: boolean) => void;
  onEmailClick: (email: WebmailListItem) => void;
  loading?: boolean;
  onStarEmail: (id: string) => void;
  onArchiveEmail: (id: string) => void;
  onTrashEmail: (id: string) => void;
  /** Rendered when the list is empty -- worded per folder by the caller. */
  emptyState: React.ReactNode;
  /** Threads sharing a threadId collapse to one row; this is the group size. */
  threadCounts?: Record<string, number>;
  /** From the holder's settings (PRD S1). Drives row height and the preview. */
  density?: Density;
};

/**
 * What a mail client shows: the time if it arrived today, the weekday if it
 * arrived this week, otherwise a date. `formatDistanceToNow` gave "10
 * months", which tells you nothing you can act on and cannot be scanned
 * down a column.
 */
function listDate(date: Date): string {
  if (isToday(date)) return format(date, 'HH:mm');
  if (differenceInCalendarDays(new Date(), date) < 7) return format(date, 'EEE');
  if (isThisYear(date)) return format(date, 'd MMM');
  return format(date, 'dd/MM/yy');
}

export default function WebmailList({
  emails,
  selectedIds,
  onSelectEmail,
  onEmailClick,
  loading = false,
  onStarEmail,
  onArchiveEmail,
  onTrashEmail,
  emptyState,
  threadCounts,
  density = 'comfortable',
}: WebmailListProps) {
  const [hoveredEmail, setHoveredEmail] = useState<string | null>(null);

  const stop = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };

  const rowPadding = density === 'compact' ? 'py-1' : 'py-2.5';

  if (loading) {
    return (
      <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className={`flex items-center gap-3 px-4 ${rowPadding} animate-pulse`}>
            <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded w-44 flex-shrink-0" />
            <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded flex-1" />
            <div className="h-3.5 w-12 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return <div className="py-16 px-6 text-center">{emptyState}</div>;
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
      {emails.map((email) => {
        const threadCount = email.threadId ? (threadCounts?.[email.threadId] ?? 1) : 1;
        const selected = selectedIds.includes(email.id);
        const unread = !email.isRead;

        return (
          <div
            key={email.id}
            role="button"
            tabIndex={0}
            onClick={() => onEmailClick(email)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onEmailClick(email);
              }
            }}
            onMouseEnter={() => setHoveredEmail(email.id)}
            onMouseLeave={() => setHoveredEmail(null)}
            className={`group relative flex items-start md:items-center gap-3 pl-3 pr-4 ${rowPadding} cursor-pointer transition-colors ${
              selected
                ? 'bg-primary/10'
                : unread
                  ? 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50'
            }`}
          >
            {/* Unread marker. A left rule rather than a tinted row: the old
                blue wash was invisible against the dark theme, so "2 unread"
                in the header pointed at nothing you could see. */}
            <span
              aria-hidden
              className={`absolute left-0 top-0 bottom-0 w-[3px] ${
                unread ? 'bg-primary' : 'bg-transparent'
              }`}
            />

            <div className="flex items-center gap-3 flex-shrink-0 pt-0.5 md:pt-0">
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => onSelectEmail(email.id, e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select "${email.subject}"`}
                className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-primary/20"
              />

              <button
                onClick={(e) => stop(e, () => onStarEmail(email.id))}
                className="text-gray-300 dark:text-gray-600 hover:text-amber-400"
                title={email.isStarred ? 'Unstar' : 'Star'}
                aria-label={email.isStarred ? 'Unstar' : 'Star'}
              >
                <Star
                  size={16}
                  className={email.isStarred ? 'fill-amber-400 text-amber-400' : ''}
                />
              </button>
            </div>

            {/* Wide layout: sender | subject — preview | date, one baseline. */}
            <div className="hidden md:flex items-center gap-4 flex-1 min-w-0">
              <span
                className={`w-44 lg:w-56 flex-shrink-0 truncate text-sm ${
                  unread
                    ? 'font-semibold text-gray-900 dark:text-gray-50'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
                title={email.fromEmail || email.from}
              >
                {email.from}
                {threadCount > 1 && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400">{threadCount}</span>
                )}
              </span>

              <span className="flex-1 min-w-0 truncate text-sm">
                {email.isAnswered && (
                  <CornerUpLeft
                    size={13}
                    className="inline-block mr-1.5 -mt-0.5 text-gray-400"
                    aria-label="Replied"
                  />
                )}
                {email.isDraft && (
                  <FileEdit
                    size={13}
                    className="inline-block mr-1.5 -mt-0.5 text-amber-500"
                    aria-label="Draft"
                  />
                )}
                <span
                  className={
                    unread
                      ? 'font-semibold text-gray-900 dark:text-gray-50'
                      : 'text-gray-800 dark:text-gray-200'
                  }
                >
                  {email.subject}
                </span>
                {density !== 'compact' && email.preview && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {'  —  '}
                    {email.preview}
                  </span>
                )}
              </span>
            </div>

            {/* Narrow layout: two lines, because three columns do not fit. */}
            <div className="flex md:hidden flex-col flex-1 min-w-0 gap-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`truncate text-sm ${
                    unread
                      ? 'font-semibold text-gray-900 dark:text-gray-50'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {email.from}
                </span>
                <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
                  {listDate(email.timestamp)}
                </span>
              </div>
              <span
                className={`truncate text-sm ${
                  unread
                    ? 'font-semibold text-gray-900 dark:text-gray-50'
                    : 'text-gray-800 dark:text-gray-200'
                }`}
              >
                {email.subject}
              </span>
              {density !== 'compact' && email.preview && (
                <span className="truncate text-xs text-gray-400 dark:text-gray-500">
                  {email.preview}
                </span>
              )}
            </div>

            {/* Date column, wide layout only. Fixed width and tabular figures
                so the dates line up as a column instead of ragging. */}
            <div className="hidden md:flex items-center gap-2 flex-shrink-0 w-[5.5rem] justify-end">
              {email.hasAttachment && (
                <Paperclip size={14} className="text-gray-400 flex-shrink-0" aria-label="Has attachment" />
              )}
              <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
                {listDate(email.timestamp)}
              </span>
            </div>

            {/* Hover actions sit ON TOP of the date rather than replacing it,
                so the date column does not flicker as the pointer moves down
                the list. */}
            {hoveredEmail === email.id && (
              <div className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 items-center gap-0.5 rounded-md bg-white dark:bg-gray-800 shadow-sm ring-1 ring-gray-200 dark:ring-gray-700 px-0.5 py-0.5">
                <button
                  onClick={(e) => stop(e, () => onArchiveEmail(email.id))}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  title="Archive"
                  aria-label="Archive"
                >
                  <Archive size={15} className="text-gray-500" />
                </button>
                <button
                  onClick={(e) => stop(e, () => onTrashEmail(email.id))}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  title="Move to Trash"
                  aria-label="Move to Trash"
                >
                  <Trash2 size={15} className="text-gray-500" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
