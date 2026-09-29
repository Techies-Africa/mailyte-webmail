'use client';

/**
 * Files: every attachment in the mailbox, newest first, each one linking back
 * to the email it came in.
 *
 * "I need a list of files from all emails so I can easily locate files, and
 * it links me to the email they were extracted from" (2026-09-29). The
 * paperclip pill finds EMAILS with attachments, one folder at a time; this
 * lists the files themselves, across every folder except Trash, Spam and
 * Drafts. Signature logos and pictures pasted into a message body are left
 * out -- they would bury the real files.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Mail,
  Menu as MenuIcon,
  Paperclip,
  Presentation,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import PageShell, { pageMenuButtonProps, usePageMenu } from '@/components/webmail/shell/PageShell';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import { FilterPill } from '@/components/ui/Pill';
import { formatBytes } from '@/components/webmail/compose/attachments';
import {
  attachmentPreviewUrl,
  attachmentUrl,
  isPreviewableAttachment,
  type ApiFile,
  type FileKind,
} from '@/lib/webmail/client';
import { formatDate, formatMonth } from '@/lib/webmail/dates';
import { useFiles } from '@/lib/webmail/query/fileQueries';

const KINDS: { kind: FileKind | null; label: string }[] = [
  { kind: null, label: 'All' },
  { kind: 'images', label: 'Images' },
  { kind: 'pdfs', label: 'PDFs' },
  { kind: 'documents', label: 'Documents' },
  { kind: 'spreadsheets', label: 'Spreadsheets' },
  { kind: 'presentations', label: 'Slides' },
  { kind: 'archives', label: 'Zip files' },
  { kind: 'media', label: 'Audio & video' },
  { kind: 'other', label: 'Other' },
];

const KIND_STYLE: Record<FileKind, { icon: React.ReactNode; tint: string }> = {
  images: { icon: <FileImage />, tint: 'bg-[hsl(280_65%_62%/0.14)] text-[hsl(280_55%_52%)]' },
  pdfs: { icon: <FileText />, tint: 'bg-destructive/[0.12] text-destructive' },
  documents: { icon: <FileText />, tint: 'bg-primary/10 text-primary' },
  spreadsheets: { icon: <FileSpreadsheet />, tint: 'bg-success/[0.12] text-success' },
  presentations: { icon: <Presentation />, tint: 'bg-warning/[0.14] text-warning' },
  archives: { icon: <FileArchive />, tint: 'bg-muted text-muted-foreground' },
  media: { icon: <FileVideo />, tint: 'bg-[hsl(200_75%_55%/0.14)] text-[hsl(200_70%_42%)]' },
  other: { icon: <File />, tint: 'bg-muted text-muted-foreground' },
};

/** The email a file came in, opened in the inbox. */
function emailHref(file: ApiFile): string {
  const params = new URLSearchParams();
  if (file.folder !== 'INBOX') params.set('folder', file.folder);
  params.set('id', file.message_id);
  return `/?${params}`;
}

function senderOf(file: ApiFile): string {
  return file.from.name?.trim() || file.from.email || 'Unknown sender';
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
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FileKind | null>(null);

  // Every search reads the mailbox on the server, so it waits for a pause
  // in typing rather than going out on every key.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(typed.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const result = useFiles(query, kind);
  const { data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = result;
  const pages = data?.pages;
  const files = useMemo(() => pages?.flatMap((p) => p.files) ?? [], [pages]);
  const checked = pages?.reduce((sum, p) => sum + p.scanned, 0) ?? 0;
  const totalEmails = pages?.at(-1)?.total_messages ?? 0;
  const narrowed = query !== '' || kind !== null;

  // The next page loads as the end of the list comes into view. A narrow
  // search can come back with a few files or none -- the server reads a few
  // hundred emails per request -- and then the end is still in view, so it
  // simply carries on until the screen is full or the mailbox is done.
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

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-card">
      <header className="shrink-0 border-b border-border px-3 pb-2 pt-2.5 sm:px-5">
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
              placeholder="File name, subject or sender"
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
          <IconButton label="Refresh" size="sm" onClick={() => void result.refetch()} className="max-sm:ml-auto">
            <RefreshCw size={13} strokeWidth={2.2} className={result.isRefetching && !isFetchingNextPage ? 'animate-spin' : ''} />
          </IconButton>
        </div>
        {/* Scrolls sideways on a phone rather than wrapping into three rows. */}
        <div className="thin-scroll -mx-1 mt-2 flex items-center gap-1 overflow-x-auto px-1 pb-0.5">
          {KINDS.map((k) => (
            <FilterPill key={k.label} active={kind === k.kind} onClick={() => setKind(k.kind)} className="shrink-0">
              {k.label}
            </FilterPill>
          ))}
        </div>
      </header>

      <div className="thin-scroll flex-1 overflow-y-auto">
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
                ? 'Try another word, or pick All. Search looks at file names, subjects and senders.'
                : 'Files people send you, and files you send, will be listed here.'}
            </p>
          </div>
        ) : (
          <FileList files={files} />
        )}

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
              // Counting emails, not files: that is what the server reads.
              <>
                Looking through older emails&hellip; {checked.toLocaleString('en-US')} of {totalEmails.toLocaleString('en-US')}
              </>
            ) : files.length > 0 ? (
              <>
                {files.length.toLocaleString('en-US')} file{files.length === 1 ? '' : 's'}
                {narrowed ? ' found' : ''}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** The files under month headings, the way people remember when something came. */
function FileList({ files }: { files: ApiFile[] }) {
  const groups = useMemo(() => {
    const out: { month: string; files: ApiFile[] }[] = [];
    for (const file of files) {
      const month = file.received_at ? formatMonth(new Date(file.received_at)) : 'Undated';
      const last = out.at(-1);
      if (last && last.month === month) last.files.push(file);
      else out.push({ month, files: [file] });
    }
    return out;
  }, [files]);

  return (
    <div>
      {groups.map((group, i) => (
        <section key={`${group.month}-${i}`} aria-label={group.month}>
          <h2 className="sticky top-0 z-[1] border-b border-border bg-pane/95 px-4 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground backdrop-blur sm:px-5">
            {group.month}
          </h2>
          <ul className="divide-y divide-border">
            {group.files.map((file) => (
              <FileRow key={file.id} file={file} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * One file. The name opens it -- a preview in a new tab when the browser can
 * show the type itself, otherwise a download (the same rule as the chips
 * under a message: a sender's HTML or Office file is never rendered here).
 * The subject line opens the email it came in.
 */
function FileRow({ file }: { file: ApiFile }) {
  const href = attachmentUrl(file.message_id, file.index);
  const previewable = isPreviewableAttachment(file.type);
  const style = KIND_STYLE[file.kind] ?? KIND_STYLE.other;
  const date = file.received_at ? formatDate(new Date(file.received_at)) : null;

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 sm:px-5">
      <span
        aria-hidden
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:h-[17px] [&>svg]:w-[17px] ${style.tint}`}
      >
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={previewable ? attachmentPreviewUrl(file.message_id, file.index) : href}
          target={previewable ? '_blank' : undefined}
          rel={previewable ? 'noopener' : undefined}
          download={previewable ? undefined : file.name}
          title={previewable ? `Open ${file.name} in a new tab` : `Download ${file.name}`}
          className="block truncate text-[13px] font-semibold text-foreground hover:underline"
        >
          {file.name}
        </a>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {[formatBytes(file.size), senderOf(file), date].filter(Boolean).join(' · ')}
        </p>
        <Link
          href={emailHref(file)}
          title="Open the email this file came in"
          className="mt-0.5 flex min-w-0 items-center gap-1 text-[11.5px] text-primary hover:underline"
        >
          <Mail size={11} className="shrink-0" />
          <span className="truncate">{file.subject || '(no subject)'}</span>
        </Link>
      </div>
      <a
        href={href}
        download={file.name}
        title={`Download ${file.name}`}
        aria-label={`Download ${file.name}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Download size={14} />
      </a>
    </li>
  );
}
