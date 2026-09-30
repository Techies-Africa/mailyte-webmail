'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Download, Mail, X } from 'lucide-react';
import { formatBytes } from '@/components/webmail/compose/attachments';
import { attachmentUrl, type ApiFile } from '@/lib/webmail/client';
import { formatDate } from '@/lib/webmail/dates';
import { isTypingTarget } from '@/lib/webmail/useKeyboardShortcuts';
import FilePreview from './FilePreview';
import { counterpartOf, emailHref, kindStyle } from './fileMeta';

/**
 * A file opened over the page, as Google Drive and Zoho open one: dark
 * surround, the file in the middle, its name and actions along the top.
 * Escape closes; the arrow keys (and the side buttons) step through the list
 * it was opened from. Focus goes to Close on open and back where it was on
 * close.
 */
export default function FileViewer({
  files,
  index,
  onIndex,
  onClose,
  emailLink = true,
}: {
  files: ApiFile[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Off when the viewer is opened from the email itself. */
  emailLink?: boolean;
}) {
  const file = files[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  const hasPrev = index > 0;
  const hasNext = index < files.length - 1;

  // Read through refs: the listener stays put while the list pages in.
  const nav = useRef({ index, count: files.length, onIndex, onClose });
  useEffect(() => {
    nav.current = { index, count: files.length, onIndex, onClose };
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const { index: i, count, onIndex: go, onClose: close } = nav.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowLeft' && i > 0) {
        event.preventDefault();
        go(i - 1);
      } else if (event.key === 'ArrowRight' && i < count - 1) {
        event.preventDefault();
        go(i + 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  if (!file) return null;
  const style = kindStyle(file.kind);
  const date = file.received_at ? formatDate(new Date(file.received_at)) : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      // Above the docked compose windows (z-140) and the account menu (z-160).
      className="fixed inset-0 z-[170] flex animate-fade-in flex-col bg-[#09090b]/[0.98] text-white"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-2.5 sm:px-5">
        <span
          aria-hidden
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4 ${style.tint}`}
        >
          {style.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13.5px] font-semibold">{file.name}</h2>
          <p className="truncate text-[11.5px] text-white/60">
            {[formatBytes(file.size), counterpartOf(file), date].filter(Boolean).join(' · ')}
            {files.length > 1 && <span className="ml-2 text-white/40">{`${index + 1} of ${files.length}`}</span>}
          </p>
        </div>
        {emailLink && (
        <>
        <Link
          href={emailHref(file)}
          title={`Open the email: ${file.subject || '(no subject)'}`}
          className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-white/85 hover:bg-white/10 hover:text-white sm:inline-flex"
        >
          <Mail size={14} />
          Open email
        </Link>
        <Link
          href={emailHref(file)}
          aria-label="Open the email"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/85 hover:bg-white/10 sm:hidden"
        >
          <Mail size={15} />
        </Link>
        </>
        )}
        <a
          href={attachmentUrl(file.message_id, file.index)}
          download={file.name}
          title={`Download ${file.name}`}
          aria-label={`Download ${file.name}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/85 hover:bg-white/10 hover:text-white"
        >
          <Download size={15} />
        </a>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close (Esc)"
          title="Close (Esc)"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/85 hover:bg-white/10 hover:text-white"
        >
          <X size={17} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <FilePreview key={file.id} file={file} />
        {hasPrev && (
          <SideButton side="left" label="Previous file (←)" onClick={() => onIndex(index - 1)}>
            <ChevronLeft size={20} />
          </SideButton>
        )}
        {hasNext && (
          <SideButton side="right" label="Next file (→)" onClick={() => onIndex(index + 1)}>
            <ChevronRight size={20} />
          </SideButton>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-white/10 px-2 py-1.5 sm:px-4">
        {/* The side buttons' job on a phone, where they would cover the file. */}
        <button
          type="button"
          onClick={() => onIndex(index - 1)}
          disabled={!hasPrev}
          aria-label="Previous file"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 disabled:opacity-30 md:hidden"
        >
          <ChevronLeft size={18} />
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-[11.5px] text-white/50">
          From the email{' '}
          {emailLink ? (
            <Link href={emailHref(file)} className="text-white/80 underline-offset-2 hover:text-white hover:underline">
              {file.subject || '(no subject)'}
            </Link>
          ) : (
            <span className="text-white/80">{file.subject || '(no subject)'}</span>
          )}
        </p>
        <button
          type="button"
          onClick={() => onIndex(index + 1)}
          disabled={!hasNext}
          aria-label="Next file"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 disabled:opacity-30 md:hidden"
        >
          <ChevronRight size={18} />
        </button>
      </footer>
    </div>,
    document.body,
  );
}

function SideButton({
  side,
  label,
  onClick,
  children,
}: {
  side: 'left' | 'right';
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/85 hover:bg-black/70 hover:text-white md:flex ${
        side === 'left' ? 'left-3' : 'right-3'
      }`}
    >
      {children}
    </button>
  );
}
