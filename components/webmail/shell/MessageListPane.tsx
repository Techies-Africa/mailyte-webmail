'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  FolderInput,
  Mail,
  MailOpen,
  Menu as MenuIcon,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Search,
  ShieldCheck,
  AlertOctagon,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { WebmailListItem } from '../types';
import type { Mailbox } from '@/lib/webmail/useMailbox';
import { STARRED_VIEW, PAGE_SIZE, labelOfView } from '@/lib/webmail/useMailbox';
import { labelTitle } from '@/lib/webmail/tags';
import IconButton from '@/components/ui/IconButton';
import Button from '@/components/ui/Button';
import Menu from '@/components/ui/Menu';
import { FilterPill } from '@/components/ui/Pill';
import MessageRow from './MessageRow';
import WebmailEmptyState from '../WebmailEmptyState';
import { LIST_PANE_ID, SIDEBAR_ID } from '@/lib/webmail/paneLayout';

function formatRelativeSync(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

export function folderLabel(name: string): string {
  if (name === STARRED_VIEW) return 'Starred';
  const label = labelOfView(name);
  if (label) return labelTitle(label);
  if (name === 'INBOX') return 'Inbox';
  if (name.startsWith('Shared/')) {
    const rest = name.slice('Shared/'.length);
    const slash = rest.indexOf('/');
    const path = slash === -1 ? rest : rest.slice(slash + 1);
    return path === 'INBOX' ? 'Inbox' : path;
  }
  return name;
}

type MessageListPaneProps = {
  mailbox: Mailbox;
  onOpen: (item: WebmailListItem) => void;
  onTrashRow: (item: WebmailListItem) => void;
  onBulkMove: () => void;
  onBulkLabel: () => void;
  onBulkDeleteForever: () => void;
  /** Phone drawer trigger, shown in the header under md. */
  onOpenMenu: () => void;
  /** Whether the phone drawer is out, for the Menu button's aria-expanded. */
  menuOpen: boolean;
  /** Bumped by the `/` shortcut: opens the search field and focuses it. */
  searchSignal?: number;
};

/**
 * The middle column: folder title and tools, the search field, the filter
 * pills, the bulk bar, then the rows.
 */
export default function MessageListPane({
  mailbox,
  onOpen,
  onTrashRow,
  onBulkMove,
  onBulkLabel,
  onBulkDeleteForever,
  onOpenMenu,
  menuOpen,
  searchSignal = 0,
}: MessageListPaneProps) {
  const {
    activeFolder,
    activeFolderMeta,
    inTrash,
    inJunk,
    messages,
    total,
    offset,
    loadingList,
    refreshing,
    isPlaceholderPage,
    prefetchNextPage,
    prefetchMessage,
    error,
    lastSyncAt,
    refreshAll,
    goToPage,
    selectedIds,
    setSelectedIds,
    search,
    setSearch,
    activeSearch,
    searchScope,
    runSearch,
    clearSearch,
    filter,
    setFilter,
    sendTimes,
    openMessage,
    settings,
    archive,
    trash,
    setRead,
    markSpam,
    markNotSpam,
    markAllRead,
    markingAllRead,
    toggleStar,
    cancelScheduledSend,
  } = mailbox;

  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // A cached view now replaces the last one in the same frame, so the
  // scroll position has to be reset by hand: a new folder starts at the top.
  const rowsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rowsRef.current?.scrollTo({ top: 0 });
  }, [activeFolder, activeSearch, searchScope, filter, offset]);
  const [scope, setScope] = useState(searchScope);

  // Open the field automatically when there is an active search (a deep link
  // or the `/` shortcut), and focus it.
  useEffect(() => {
    if (activeSearch) setShowSearch(true);
  }, [activeSearch]);

  useEffect(() => {
    if (showSearch) searchRef.current?.focus();
  }, [showSearch]);

  useEffect(() => {
    if (searchSignal > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowSearch(true);
      searchRef.current?.focus();
    }
  }, [searchSignal]);

  const title = folderLabel(activeFolder);
  const isStarredView = activeFolder === STARRED_VIEW;
  const isLabelView = labelOfView(activeFolder) !== null;
  // Automatic tags describe incoming mail; a sent message or a draft is yours.
  const autoTags = activeFolderMeta?.role !== 'sent' && activeFolderMeta?.role !== 'drafts';
  const allSelected = messages.length > 0 && selectedIds.length === messages.length;
  const rangeStart = messages.length === 0 ? 0 : offset + 1;
  const rangeEnd = offset + messages.length;
  const hasPrev = offset > 0;
  const hasNext = rangeEnd < total;
  const showFolderTags = activeSearch !== '' && searchScope === 'all';
  const density = settings?.displayDensity ?? 'comfortable';

  const submitSearch = () => {
    runSearch(search, scope);
  };

  const closeSearch = () => {
    setShowSearch(false);
    if (activeSearch || search) clearSearch();
  };

  const bulkMenuItems = [
    { key: 'read', label: 'Mark as read', icon: <MailOpen size={14} />, onSelect: () => void setRead(selectedIds, true) },
    { key: 'unread', label: 'Mark as unread', icon: <Mail size={14} />, onSelect: () => void setRead(selectedIds, false) },
    { key: 'label', label: 'Label…', icon: <Tag size={14} />, onSelect: onBulkLabel },
    { key: 'move', label: 'Move to folder…', icon: <FolderInput size={14} />, onSelect: onBulkMove },
    ...(inJunk
      ? [{ key: 'notspam', label: 'Not spam — move to Inbox', icon: <ShieldCheck size={14} />, onSelect: () => void markNotSpam(selectedIds) }]
      : [{ key: 'spam', label: 'Report spam', icon: <AlertOctagon size={14} />, onSelect: () => void markSpam(selectedIds) }]),
    ...(inTrash
      ? [{ key: 'forever', label: 'Delete forever', icon: <Trash2 size={14} />, tone: 'danger' as const, onSelect: onBulkDeleteForever }]
      : []),
  ];

  return (
    // pane-list: the full width on a phone, the remembered (draggable) width
    // at md and up -- set in CSS (globals.css), so it is right on the first
    // render rather than after an effect has measured the window.
    <section
      id={LIST_PANE_ID}
      aria-label={`${title} messages`}
      className="pane-list flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-border bg-card"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-border px-3.5 pb-2 pt-3">
        <div className="mb-2 flex items-center gap-1.5">
          <IconButton
            label="Menu"
            size="sm"
            onClick={onOpenMenu}
            aria-expanded={menuOpen}
            aria-controls={SIDEBAR_ID}
            className="md:hidden"
          >
            <MenuIcon size={15} />
          </IconButton>
          <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-bold tracking-tight">
            {title}
            {isStarredView && (
              <span className="ml-1.5 font-sans text-[11px] font-medium text-muted-foreground">in Inbox</span>
            )}
            {isLabelView && (
              <span className="ml-1.5 font-sans text-[11px] font-medium text-muted-foreground">label · all folders</span>
            )}
          </h2>
          <IconButton
            label="Search"
            size="sm"
            active={showSearch}
            tone={showSearch ? 'primary' : 'default'}
            onClick={() => (showSearch ? closeSearch() : setShowSearch(true))}
          >
            <Search size={13} strokeWidth={2.2} />
          </IconButton>
          {!isStarredView && !isLabelView && (
            <IconButton
              label="Mark all as read"
              size="sm"
              onClick={() => void markAllRead()}
              disabled={markingAllRead}
            >
              <CheckCheck size={14} className={markingAllRead ? 'animate-pulse' : ''} />
            </IconButton>
          )}
          <IconButton label="Refresh (g)" size="sm" onClick={refreshAll}>
            <RefreshCw size={13} strokeWidth={2.2} className={refreshing ? 'animate-spin' : ''} />
          </IconButton>
        </div>

        {showSearch && (
          <div className="mb-2 animate-fade-in">
            <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5">
              <Search size={12} strokeWidth={2.2} className="shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                type="search"
                data-webmail-search
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitSearch();
                  if (e.key === 'Escape') {
                    e.preventDefault(); // handled: an open reply or message stays put
                    closeSearch();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder={scope === 'all' ? 'Search all mail…' : `Search in ${title}…`}
                aria-label="Search messages"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70 [&::-webkit-search-cancel-button]:hidden"
              />
              {(search || activeSearch) && (
                <button
                  type="button"
                  onClick={closeSearch}
                  aria-label="Clear search"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <FilterPill active={scope === 'folder'} onClick={() => setScope('folder')}>
                This folder
              </FilterPill>
              <FilterPill active={scope === 'all'} onClick={() => setScope('all')}>
                All mail
              </FilterPill>
              <span className="ml-auto text-[10.5px] text-muted-foreground">Enter to search</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <label
            className="flex items-center gap-1.5 rounded-[7px] border border-border bg-pane px-1.5 py-[3px]"
            title="Select every message on this page"
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedIds.length > 0 && !allSelected;
              }}
              onChange={(e) => setSelectedIds(e.target.checked ? messages.map((m) => m.id) : [])}
              aria-label="Select all messages on this page"
              className="h-3 w-3 cursor-pointer accent-primary"
            />
            <span className="text-[10.5px] font-semibold text-muted-foreground">All</span>
          </label>
          <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </FilterPill>
          <FilterPill active={filter === 'unread'} onClick={() => setFilter('unread')}>
            Unread
          </FilterPill>
          {!isStarredView && (
            <FilterPill active={filter === 'starred'} onClick={() => setFilter('starred')}>
              Starred
            </FilterPill>
          )}
          <FilterPill
            active={filter === 'attachments'}
            onClick={() => setFilter('attachments')}
            title="Messages on this page with attachments"
          >
            <Paperclip size={11} />
          </FilterPill>
        </div>
      </div>

      {/* Bulk bar */}
      {selectedIds.length > 0 && (
        <div className="flex shrink-0 animate-fade-in items-center gap-1.5 border-b border-selection-strong bg-selection px-3.5 py-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-primary">
            {selectedIds.length} selected
          </span>
          <Button size="xs" onClick={() => void setRead(selectedIds, true)}>
            Mark read
          </Button>
          {!inTrash && (
            <Button size="xs" icon={<Archive size={12} />} onClick={() => void archive(selectedIds)}>
              Archive
            </Button>
          )}
          {inTrash ? (
            <Button size="xs" variant="danger" onClick={onBulkDeleteForever}>
              Delete forever
            </Button>
          ) : (
            <Button size="xs" variant="danger" onClick={() => void trash(selectedIds)}>
              Delete
            </Button>
          )}
          <Menu
            label="More actions"
            align="right"
            items={bulkMenuItems}
            trigger={({ toggle, open }) => (
              <IconButton label="More actions" size="xs" onClick={toggle} active={open}>
                <MoreHorizontal size={13} />
              </IconButton>
            )}
          />
          <IconButton label="Clear selection" size="xs" onClick={() => setSelectedIds([])}>
            <X size={12} strokeWidth={2.6} />
          </IconButton>
        </div>
      )}

      {activeSearch && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-pane px-3.5 py-1.5 text-[11.5px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {total} result{total === 1 ? '' : 's'} for &ldquo;{activeSearch}&rdquo;{' '}
            {searchScope === 'all' ? 'across all mail' : `in ${title}`}
          </span>
          <button type="button" onClick={closeSearch} className="shrink-0 font-semibold text-primary hover:underline">
            Clear
          </button>
        </div>
      )}

      {filter === 'attachments' && (
        <div className="shrink-0 border-b border-border bg-pane px-3.5 py-1 text-[11px] text-muted-foreground">
          Showing messages on this page that have attachments.
        </div>
      )}

      {error && (
        <div className="flex shrink-0 items-center justify-between gap-3 bg-destructive/10 px-3.5 py-2 text-[12px] text-destructive">
          <span className="min-w-0 truncate">{error}</span>
          <button type="button" onClick={refreshAll} className="shrink-0 font-semibold underline underline-offset-2">
            Try again
          </button>
        </div>
      )}

      {/* Rows */}
      {/* A neighbouring page stands in, dimmed, while the asked-for one loads. */}
      <div
        ref={rowsRef}
        className={`thin-scroll min-h-0 flex-1 overflow-y-auto transition-opacity ${isPlaceholderPage ? 'opacity-60' : ''}`}
      >
        {loadingList ? (
          <div>
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="flex items-start gap-2 border-b border-border/70 px-3 py-2.5"
                style={{ opacity: 1 - i * 0.08 }}
              >
                <div className="mt-0.5 h-[13px] w-[13px] animate-pulse rounded bg-muted" />
                <div className="h-[26px] w-[26px] animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-3/5 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <WebmailEmptyState
            folder={activeFolder}
            role={activeFolderMeta?.role ?? null}
            searchQuery={activeSearch || undefined}
            filter={filter}
            labelView={labelOfView(activeFolder) ? title : undefined}
          />
        ) : (
          messages.map((email) => (
            <MessageRow
              key={email.id}
              email={email}
              selected={selectedIds.includes(email.id)}
              open={openMessage?.id === email.id}
              density={density}
              scheduled={sendTimes[email.id]}
              showFolder={showFolderTags || isLabelView}
              autoTags={autoTags}
              onOpen={() => onOpen(email)}
              onHover={() => prefetchMessage(email)}
              onSelect={(selected) =>
                setSelectedIds((prev) =>
                  selected ? [...prev, email.id] : prev.filter((id) => id !== email.id),
                )
              }
              onStar={() => void toggleStar(email.id)}
              onArchive={inTrash ? undefined : () => void archive([email.id])}
              onTrash={() => onTrashRow(email)}
              onCancelScheduled={sendTimes[email.id] ? () => void cancelScheduledSend(email.id) : undefined}
            />
          ))
        )}
      </div>

      {/* Footer: range, paging, sync */}
      <div className="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {total === 0 ? 'No messages' : `${rangeStart}–${rangeEnd} of ${total}`}
          {lastSyncAt && (
            <span className="hidden sm:inline"> · Synced {formatRelativeSync(lastSyncAt)}</span>
          )}
        </span>
        <IconButton
          label="Newer messages"
          size="xs"
          disabled={!hasPrev}
          onClick={() => goToPage(Math.max(0, offset - PAGE_SIZE))}
        >
          <ChevronLeft size={14} />
        </IconButton>
        <IconButton
          label="Older messages"
          size="xs"
          disabled={!hasNext}
          onClick={() => goToPage(offset + PAGE_SIZE)}
          onMouseEnter={prefetchNextPage}
        >
          <ChevronRight size={14} />
        </IconButton>
      </div>
    </section>
  );
}
