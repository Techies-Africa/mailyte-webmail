'use client';

/**
 * Files: every attachment in the mailbox, each one linking back to the email
 * it came in.
 *
 * "I need a list of files from all emails so I can easily locate files, and
 * it links me to the email they were extracted from" (2026-09-29), then
 * "a nice looking summary and overview, sort and filter options, and view
 * the files in the page like Google and Zoho instead of opening a new tab"
 * (2026-09-30).
 *
 * Top to bottom: the overview (the whole mailbox at a glance; its rows
 * narrow the list), the filter bar (type, received or sent, when, size, who,
 * and the order), then the files as a list or as preview cards. A file opens
 * in the viewer over the page; its email is one click from there.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Check,
  ChevronDown,
  Download,
  LayoutGrid,
  List,
  Mail,
  Menu as MenuIcon,
  Paperclip,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import PageShell, { pageMenuButtonProps, usePageMenu } from '@/components/webmail/shell/PageShell';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Menu from '@/components/ui/Menu';
import { FilterPill } from '@/components/ui/Pill';
import { formatBytes } from '@/components/webmail/compose/attachments';
import FilesOverview from '@/components/webmail/files/FilesOverview';
import FileViewer from '@/components/webmail/files/FileViewer';
import {
  counterpartOf,
  emailHref,
  extensionOf,
  formatCount,
  INLINE_IMAGE,
  KIND_LABEL,
  KIND_ORDER,
  kindStyle,
} from '@/components/webmail/files/fileMeta';
import {
  attachmentPreviewUrl,
  attachmentUrl,
  type ApiFile,
  type FileFilters,
  type FileKind,
  type FileSort,
} from '@/lib/webmail/client';
import { formatDate, formatMonth } from '@/lib/webmail/dates';
import { useCapabilities } from '@/lib/webmail/query/accountQueries';
import { useFiles, useFilesSummary } from '@/lib/webmail/query/fileQueries';
import { FILES_OVERVIEW_KEY, FILES_VIEW_KEY, useRememberedChoice } from '@/lib/webmail/useRememberedChoice';

type FilesView = 'list' | 'preview';
type Direction = 'all' | 'received' | 'sent';
type Range = 'any' | '7d' | '30d' | '1y';
type SizeBand = 'any' | 'over1' | 'over10' | 'under100k';

const VIEWS: { view: FilesView; label: string; icon: React.ReactNode }[] = [
  { view: 'list', label: 'List', icon: <List size={13} /> },
  { view: 'preview', label: 'Preview', icon: <LayoutGrid size={13} /> },
];

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: 'all', label: 'Received & sent' },
  { value: 'received', label: 'Received' },
  { value: 'sent', label: 'Sent' },
];

const RANGES: { value: Range; label: string; days: number | null }[] = [
  { value: 'any', label: 'Any time', days: null },
  { value: '7d', label: 'Past 7 days', days: 7 },
  { value: '30d', label: 'Past 30 days', days: 30 },
  { value: '1y', label: 'Past year', days: 365 },
];

const SIZES: { value: SizeBand; label: string; min?: number; max?: number }[] = [
  { value: 'any', label: 'Any size' },
  { value: 'over1', label: 'Over 1 MB', min: 1024 * 1024 },
  { value: 'over10', label: 'Over 10 MB', min: 10 * 1024 * 1024 },
  { value: 'under100k', label: 'Under 100 KB', max: 100 * 1024 },
];

const SORTS: { value: FileSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'largest', label: 'Largest first' },
  { value: 'smallest', label: 'Smallest first' },
  { value: 'name', label: 'Name A–Z' },
];

/** YYYY-MM-DD, `days` ago, as the mail server's `since` expects. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export default function FilesPage() {
  return (
    <PageShell current="files">
      <FilesScreen />
    </PageShell>
  );
}

function FilesScreen() {
  const [menuOpen, openMenu] = usePageMenu();
  const email = useCapabilities().data?.email_address ?? null;
  const [rememberedView, rememberView] = useRememberedChoice(FILES_VIEW_KEY, email);
  const view: FilesView = rememberedView === 'preview' ? 'preview' : 'list';
  const [rememberedOverview, rememberOverview] = useRememberedChoice(FILES_OVERVIEW_KEY, email);
  const overviewShown = rememberedOverview !== 'hidden';

  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FileKind | null>(null);
  const [direction, setDirection] = useState<Direction>('all');
  const [range, setRange] = useState<Range>('any');
  const [size, setSize] = useState<SizeBand>('any');
  const [person, setPerson] = useState<string | null>(null);
  const [sort, setSort] = useState<FileSort>('newest');

  // Every search reads the index on the server, so it waits for a pause in
  // typing rather than going out on every key.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(typed.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const filters = useMemo<FileFilters>(() => {
    const days = RANGES.find((r) => r.value === range)?.days ?? null;
    const band = SIZES.find((s) => s.value === size);
    return {
      q: query || undefined,
      kind,
      person,
      direction: direction === 'all' ? null : direction,
      since: days ? daysAgo(days) : null,
      minSize: band?.min ?? null,
      maxSize: band?.max ?? null,
      sort,
    };
  }, [query, kind, person, direction, range, size, sort]);

  const narrowed = query !== '' || kind !== null || person !== null || direction !== 'all' || range !== 'any' || size !== 'any';
  const clearFilters = () => {
    setTyped('');
    setQuery('');
    setKind(null);
    setPerson(null);
    setDirection('all');
    setRange('any');
    setSize('any');
  };

  const result = useFiles(filters);
  const summary = useFilesSummary();
  const { data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = result;
  const pages = data?.pages;
  const files = useMemo(() => pages?.flatMap((p) => p.files) ?? [], [pages]);
  const total = pages?.[0]?.total;
  // A new filter keeps the last list up, dimmed, until its answer lands.
  const stale = result.isPlaceholderData;

  // The file open in the viewer, and the list it steps through.
  const [viewer, setViewer] = useState<{ source: 'list' | 'largest'; index: number } | null>(null);
  const viewerFiles = viewer?.source === 'largest' ? (summary.data?.largest ?? []) : files;

  // The next page loads as the end of the list comes into view.
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const end = endRef.current;
    if (!end || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, files.length]);

  const senders = summary.data?.top_senders ?? [];
  const personLabel = person ? (senders.find((s) => s.email === person)?.name?.trim() || person) : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-card">
      <header className="shrink-0 border-b border-border px-3 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <IconButton label="Menu" size="sm" onClick={openMenu} {...pageMenuButtonProps(menuOpen)} className="md:hidden">
            <MenuIcon size={15} />
          </IconButton>
          <h1 className="font-display text-[15px] font-bold tracking-tight">Files</h1>
          {/* On a phone the search takes a row of its own, full width. */}
          <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 max-sm:order-last max-sm:w-full sm:ml-auto">
            <Search size={12} strokeWidth={2.2} className="shrink-0 text-muted-foreground" />
            <input
              type="search"
              enterKeyHint="search"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setQuery(typed.trim());
              }}
              placeholder="File name, subject or person"
              aria-label="Search files"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70 sm:w-64 sm:flex-none [&::-webkit-search-cancel-button]:hidden"
            />
            {typed && (
              <button
                type="button"
                onClick={() => {
                  setTyped('');
                  setQuery('');
                }}
                aria-label="Clear search"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div role="group" aria-label="View" className="flex items-center rounded-lg bg-muted p-0.5 max-sm:ml-auto">
            {VIEWS.map((v) => (
              <button
                key={v.view}
                type="button"
                aria-pressed={view === v.view}
                onClick={() => rememberView(v.view)}
                title={`${v.label} view`}
                className={[
                  'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors',
                  view === v.view ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {v.icon}
                {v.label}
              </button>
            ))}
          </div>
          <IconButton
            label={overviewShown ? 'Hide overview' : 'Show overview'}
            size="sm"
            active={overviewShown}
            onClick={() => rememberOverview(overviewShown ? 'hidden' : 'shown')}
          >
            <BarChart3 size={14} />
          </IconButton>
          <IconButton
            label="Refresh"
            size="sm"
            onClick={() => {
              void result.refetch();
              void summary.refetch();
            }}
          >
            <RefreshCw size={13} strokeWidth={2.2} className={result.isRefetching && !isFetchingNextPage ? 'animate-spin' : ''} />
          </IconButton>
        </div>
      </header>

      <div className="thin-scroll flex-1 overflow-y-auto">
        {overviewShown && (
          <section aria-label="Overview" className="border-b border-border bg-pane px-3 py-3 sm:px-5 sm:py-4">
            {summary.data ? (
              <FilesOverview
                summary={summary.data}
                activeKind={kind}
                activePerson={person}
                onPickKind={setKind}
                onPickPerson={setPerson}
                onOpenFile={(file) => {
                  const index = summary.data?.largest.findIndex((f) => f.id === file.id) ?? -1;
                  setViewer({ source: 'largest', index: Math.max(0, index) });
                }}
              />
            ) : summary.isError ? (
              <p className="text-[12.5px] text-muted-foreground">
                The overview could not be loaded.{' '}
                <button type="button" onClick={() => void summary.refetch()} className="font-semibold text-primary hover:underline">
                  Try again
                </button>
              </p>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">Adding up your files&hellip;</p>
            )}
          </section>
        )}

        {/* The filters, pinned while the list scrolls under them. */}
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 px-3 pb-2 pt-2.5 backdrop-blur sm:px-5">
          {/* Scrolls sideways on a phone rather than wrapping into three rows. */}
          <div className="thin-scroll -mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1">
            <FilterPill active={kind === null} onClick={() => setKind(null)} className="shrink-0">
              All types
            </FilterPill>
            {KIND_ORDER.map((k) => (
              <FilterPill key={k} active={kind === k} onClick={() => setKind(k)} className="shrink-0">
                {KIND_LABEL[k]}
              </FilterPill>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Choice label="Received or sent" options={DIRECTIONS} value={direction} onChange={setDirection} />
            <Choice label="When" options={RANGES} value={range} onChange={setRange} />
            <Choice label="Size" options={SIZES} value={size} onChange={setSize} />
            <Choice
              label="Person"
              options={[
                { value: '', label: 'Anyone' },
                ...senders.map((s) => ({ value: s.email, label: s.name?.trim() ? `${s.name.trim()} · ${s.email}` : s.email })),
                ...(person && !senders.some((s) => s.email === person) ? [{ value: person, label: person }] : []),
              ]}
              value={person ?? ''}
              onChange={(v) => setPerson(v || null)}
              display={personLabel ? `With ${personLabel}` : 'Anyone'}
            />
            {narrowed && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-md px-2 py-1 text-[11.5px] font-semibold text-primary hover:bg-primary/10"
              >
                Clear filters
              </button>
            )}
            <span className="ml-auto flex items-center gap-2">
              {total !== undefined && (
                <span className="text-[11.5px] tabular-nums text-muted-foreground" aria-live="polite">
                  {formatCount(total)} file{total === 1 ? '' : 's'}
                </span>
              )}
              <Choice label="Sort" options={SORTS} value={sort} onChange={setSort} align="right" />
            </span>
          </div>
        </div>

        <div className={stale ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {result.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Finding your files&hellip;</p>
          ) : result.isError ? (
            <div className="flex flex-col items-center gap-3 p-12 text-center">
              <p className="text-sm text-destructive">{result.error.message}</p>
              <Button size="sm" onClick={() => void result.refetch()}>
                Try again
              </Button>
            </div>
          ) : files.length === 0 && !hasNextPage ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center">
              <div className="mb-2 flex h-[72px] w-[72px] items-center justify-center rounded-[20px] bg-primary/10 text-primary">
                <Paperclip size={30} strokeWidth={1.6} />
              </div>
              <p className="font-display text-[14.5px] font-bold">{narrowed ? 'No files match' : 'No files yet'}</p>
              <p className="max-w-sm text-[12.5px] text-muted-foreground">
                {narrowed
                  ? 'Try another word or fewer filters. Search looks at file names, subjects and people.'
                  : 'Files people send you, and files you send, will be listed here.'}
              </p>
              {narrowed && (
                <Button size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <FileList
              files={files}
              view={view}
              byMonth={sort === 'newest' || sort === 'oldest'}
              onOpen={(file) => setViewer({ source: 'list', index: files.findIndex((f) => f.id === file.id) })}
            />
          )}
        </div>

        {!result.isPending && !result.isError && (
          <div ref={endRef} className="px-4 py-4 text-center text-[11.5px] text-muted-foreground sm:px-5">
            {isFetchNextPageError ? (
              <span className="inline-flex items-center gap-2">
                Could not load more files.
                <Button size="xs" onClick={() => void fetchNextPage()}>
                  Try again
                </Button>
              </span>
            ) : hasNextPage ? (
              <>Loading more&hellip;</>
            ) : files.length > 0 ? (
              <>That&rsquo;s every file{narrowed ? ' that matches' : ''}.</>
            ) : null}
          </div>
        )}
      </div>

      {viewer && viewerFiles[viewer.index] && (
        <FileViewer
          files={viewerFiles}
          index={viewer.index}
          onIndex={(index) => {
            setViewer({ ...viewer, index });
            // Stepping onto the last loaded file brings in the next page.
            if (viewer.source === 'list' && index >= files.length - 2 && hasNextPage && !isFetchingNextPage) {
              void fetchNextPage();
            }
          }}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

/** A filter as a small menu: the current choice on the button, a tick on it in the list. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  display,
  align = 'left',
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  display?: string;
  align?: 'left' | 'right';
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const isDefault = value === options[0]?.value;
  return (
    <Menu
      label={label}
      align={align}
      items={options.map((o) => ({
        key: o.value || '_',
        label: o.label,
        icon: o.value === value ? <Check size={13} className="text-primary" /> : <span className="inline-block w-[13px]" />,
        onSelect: () => onChange(o.value),
      }))}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${label}: ${display ?? current?.label}`}
          title={label}
          className={[
            'inline-flex max-w-[16rem] items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-semibold transition-colors',
            isDefault
              ? 'border-border text-muted-foreground hover:text-foreground'
              : 'border-primary/30 bg-primary/10 text-primary',
          ].join(' ')}
        >
          <span className="truncate">{display ?? current?.label}</span>
          <ChevronDown size={12} className="shrink-0" />
        </button>
      )}
    />
  );
}

/**
 * The files, under month headings when the order is by date -- the way
 * people remember when something came -- and as one run otherwise.
 */
function FileList({
  files,
  view,
  byMonth,
  onOpen,
}: {
  files: ApiFile[];
  view: FilesView;
  byMonth: boolean;
  onOpen: (file: ApiFile) => void;
}) {
  const groups = useMemo(() => {
    if (!byMonth) return [{ month: null as string | null, files }];
    const out: { month: string | null; files: ApiFile[] }[] = [];
    for (const file of files) {
      const month = file.received_at ? formatMonth(new Date(file.received_at)) : 'Undated';
      const last = out.at(-1);
      if (last && last.month === month) last.files.push(file);
      else out.push({ month, files: [file] });
    }
    return out;
  }, [files, byMonth]);

  return (
    <div>
      {groups.map((group, i) => (
        <section key={`${group.month}-${i}`} aria-label={group.month ?? 'Files'}>
          {group.month && (
            <h2 className="border-b border-border bg-pane px-4 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground sm:px-5">
              {group.month}
            </h2>
          )}
          {view === 'preview' ? (
            <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:p-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {group.files.map((file) => (
                <FileCard key={file.id} file={file} onOpen={onOpen} />
              ))}
            </ul>
          ) : (
            <ul className="divide-y divide-border">
              {group.files.map((file) => (
                <FileRow key={file.id} file={file} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function EmailLink({ file }: { file: ApiFile }) {
  return (
    <Link
      href={emailHref(file)}
      title="Open the email this file came in"
      className="mt-0.5 flex min-w-0 items-center gap-1 text-[11.5px] text-primary hover:underline"
    >
      <Mail size={11} className="shrink-0" />
      <span className="truncate">{file.subject || '(no subject)'}</span>
    </Link>
  );
}

function DownloadButton({ file, className }: { file: ApiFile; className: string }) {
  return (
    <a
      href={attachmentUrl(file.message_id, file.index)}
      download={file.name}
      title={`Download ${file.name}`}
      aria-label={`Download ${file.name}`}
      className={className}
    >
      <Download size={14} />
    </a>
  );
}

/** One file in the List view. The name opens it in the viewer; the subject line opens its email. */
function FileRow({ file, onOpen }: { file: ApiFile; onOpen: (file: ApiFile) => void }) {
  const style = kindStyle(file.kind);
  const date = file.received_at ? formatDate(new Date(file.received_at)) : null;

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 sm:px-5">
      <button
        type="button"
        onClick={() => onOpen(file)}
        aria-hidden
        tabIndex={-1}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:h-[17px] [&>svg]:w-[17px] ${style.tint}`}
      >
        {style.icon}
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(file)}
          title={`View ${file.name}`}
          aria-label={`View ${file.name}`}
          className="block max-w-full truncate text-left text-[13px] font-semibold text-foreground hover:underline"
        >
          {file.name}
        </button>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {[formatBytes(file.size), counterpartOf(file), date].filter(Boolean).join(' · ')}
        </p>
        <EmailLink file={file} />
      </div>
      <DownloadButton
        file={file}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      />
    </li>
  );
}

/**
 * One file in the Preview view: the picture itself for an image, a large
 * type tile for anything else. Pictures load only as they scroll into view
 * -- they are the full-size originals, not thumbnails.
 */
function FileCard({ file, onOpen }: { file: ApiFile; onOpen: (file: ApiFile) => void }) {
  const style = kindStyle(file.kind);
  const date = file.received_at ? formatDate(new Date(file.received_at)) : null;
  const [broken, setBroken] = useState(false);
  const picture = INLINE_IMAGE.test(file.type.toLowerCase()) && !broken;
  const extension = extensionOf(file.name);

  return (
    <li className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-panel">
      {/* The name below is the control a screen reader hears; this is the big target for a pointer. */}
      <button
        type="button"
        onClick={() => onOpen(file)}
        tabIndex={-1}
        aria-hidden
        className="relative block aspect-[4/3] overflow-hidden bg-muted"
      >
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- a same-origin attachment, not a static asset
          <img
            src={attachmentPreviewUrl(file.message_id, file.index)}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <span className={`flex h-full w-full flex-col items-center justify-center gap-1.5 [&>svg]:h-9 [&>svg]:w-9 ${style.tint}`}>
            {style.icon}
            {extension && <span className="font-mono text-[10.5px] font-semibold tracking-wider">{extension}</span>}
          </span>
        )}
      </button>
      {/* Revealed on hover with a mouse; always there on touch. */}
      <DownloadButton
        file={file}
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-card/90 text-foreground shadow-sm backdrop-blur transition-opacity hover:bg-card focus:opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100"
      />
      <div className="min-w-0 px-2.5 pb-2.5 pt-2">
        <button
          type="button"
          onClick={() => onOpen(file)}
          title={`View ${file.name}`}
          aria-label={`View ${file.name}`}
          className="block max-w-full truncate text-left text-[12.5px] font-semibold text-foreground hover:underline"
        >
          {file.name}
        </button>
        <p className="truncate text-[11px] text-muted-foreground">{[formatBytes(file.size), date].filter(Boolean).join(' · ')}</p>
        <p className="truncate text-[11px] text-muted-foreground">{counterpartOf(file)}</p>
        <EmailLink file={file} />
      </div>
    </li>
  );
}
