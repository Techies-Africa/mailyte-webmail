import { useEffect, useRef, useState } from 'react';
import {
  RefreshCw,
  Archive,
  Trash2,
  MailOpen,
  Mail,
  FolderInput,
  AlertOctagon,
  MoreHorizontal,
} from 'lucide-react';

type WebmailToolbarProps = {
  selectedCount: number;
  allSelected: boolean;
  onSelectAll: (selected: boolean) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  /** "1-50 of 812" -- rendered verbatim, the caller owns the paging maths. */
  rangeLabel: string;
  /** "Synced 2 mins ago". Omitted before the first successful sync. */
  syncedLabel?: string;
  // Same rule as the bulk actions below: no handler means there is no page
  // in that direction, so the arrow is not rendered rather than rendered
  // and greyed.
  onPrevPage?: () => void;
  onNextPage?: () => void;
  // Every bulk action below is optional on purpose: a handler that isn't
  // passed means the control is NOT RENDERED, never rendered-but-grey. The
  // PRD's E3 contract ("what remains on screen works") is enforced by this
  // signature rather than by remembering to delete a button.
  onArchiveSelected?: () => void;
  onTrashSelected?: () => void;
  onDeleteForeverSelected?: () => void;
  onMarkReadSelected?: () => void;
  onMarkUnreadSelected?: () => void;
  onMoveSelected?: () => void;
  onSpamSelected?: () => void;
};

export default function WebmailToolbar({
  selectedCount,
  allSelected,
  onSelectAll,
  onRefresh,
  refreshing = false,
  rangeLabel,
  syncedLabel,
  onPrevPage,
  onNextPage,
  onArchiveSelected,
  onTrashSelected,
  onDeleteForeverSelected,
  onMarkReadSelected,
  onMarkUnreadSelected,
  onMoveSelected,
  onSpamSelected,
}: WebmailToolbarProps) {
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMore) return;
    const onDocClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMore(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showMore]);

  const iconButton = (
    key: string,
    label: string,
    icon: React.ReactNode,
    onClick: (() => void) | undefined,
  ) =>
    onClick ? (
      <button
        key={key}
        onClick={onClick}
        className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
        title={label}
        aria-label={label}
      >
        {icon}
      </button>
    ) : null;

  const hasOverflow = !!(onMarkReadSelected || onMarkUnreadSelected || onMoveSelected);

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="webmail-select-all"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = selectedCount > 0 && !allSelected;
          }}
          onChange={(e) => onSelectAll(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-primary/20"
        />
        <label htmlFor="webmail-select-all" className="sr-only">
          Select all messages on this page
        </label>

        {selectedCount > 0 ? (
          <>
            {iconButton('archive', 'Archive', <Archive size={18} />, onArchiveSelected)}
            {iconButton('spam', 'Report spam', <AlertOctagon size={18} />, onSpamSelected)}
            {iconButton('trash', 'Move to Trash', <Trash2 size={18} />, onTrashSelected)}
            {iconButton(
              'forever',
              'Delete forever',
              <Trash2 size={18} className="text-red-500" />,
              onDeleteForeverSelected,
            )}

            {hasOverflow && (
              <div className="relative" ref={moreRef}>
                <button
                  onClick={() => setShowMore((v) => !v)}
                  className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  title="More actions"
                >
                  <MoreHorizontal size={18} />
                </button>
                {showMore && (
                  <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 shadow-lg rounded-md border border-gray-200 dark:border-gray-700 py-1 min-w-[190px] z-20">
                    {onMarkReadSelected && (
                      <button
                        onClick={() => {
                          setShowMore(false);
                          onMarkReadSelected();
                        }}
                        className="flex items-center w-full px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <MailOpen size={16} className="mr-2" />
                        Mark as read
                      </button>
                    )}
                    {onMarkUnreadSelected && (
                      <button
                        onClick={() => {
                          setShowMore(false);
                          onMarkUnreadSelected();
                        }}
                        className="flex items-center w-full px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Mail size={16} className="mr-2" />
                        Mark as unread
                      </button>
                    )}
                    {onMoveSelected && (
                      <button
                        onClick={() => {
                          setShowMore(false);
                          onMoveSelected();
                        }}
                        className="flex items-center w-full px-3 py-2 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <FolderInput size={16} className="mr-2" />
                        Move to folder…
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
              {selectedCount} selected
            </span>
          </>
        ) : (
          <button
            onClick={onRefresh}
            className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title="Refresh"
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
        {syncedLabel && <span className="hidden sm:inline mr-2">{syncedLabel}</span>}
        <span>{rangeLabel}</span>
        {onPrevPage && (
          <button
            onClick={onPrevPage}
            className="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Newer"
            aria-label="Newer messages"
          >
            ‹
          </button>
        )}
        {onNextPage && (
          <button
            onClick={onNextPage}
            className="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Older"
            aria-label="Older messages"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
