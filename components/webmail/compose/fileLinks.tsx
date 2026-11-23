'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Loader2, RotateCw, ShieldAlert, X } from 'lucide-react';
import { getFileLink, removeFileLink, type FileLinkStatus } from '@/lib/webmail/client';
import { toFileLinkRef } from '@/lib/webmail/adapters';
import { FileLinkUpload, type UploadPhase, type UploadState } from '@/lib/webmail/fileLinkUpload';

// Same wording as attachments.tsx's formatBytes, which imports this module.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Files too big to attach, sent as download links (owner, 2026-11-23).
 *
 * Each one uploads the moment it is added, while the message is still being
 * written, and shows how far it has got. Send waits until every link is
 * ready; the server then adds the links to the email.
 *
 * A link that is ready lives on the server, so it survives what an
 * attachment cannot: it is saved with the draft, kept in the browser's copy
 * of an unsent message, and comes back with Undo and Reopen.
 */

/** A file link as a compose window carries it: enough to show and to send. */
export interface FileLinkRef {
  id: string;
  name: string;
  size: number;
  status: FileLinkStatus;
  url?: string | null;
  sentAt?: string | null;
  expiresAt?: string | null;
}

export interface LinkItem {
  key: string;
  name: string;
  size: number;
  phase: UploadPhase;
  /** 0 to 1 while uploading. */
  progress: number;
  error?: string;
  retryable?: boolean;
  /** Set once the server has the file. */
  ref: FileLinkRef | null;
}

const BUSY: ReadonlySet<UploadPhase> = new Set(['starting', 'uploading', 'checking']);

function restoredItem(ref: FileLinkRef, index: number): LinkItem {
  const base = { key: `restored-${ref.id}-${index}`, name: ref.name, size: ref.size, progress: 1, ref };
  if (ref.status === 'ready') return { ...base, phase: 'ready' };
  if (ref.status === 'scanning') return { ...base, phase: 'checking' };
  if (ref.status === 'blocked') {
    return { ...base, phase: 'blocked', error: 'A virus was found in this file, so it was removed.' };
  }
  if (ref.status === 'expired') return { ...base, phase: 'failed', error: 'This link has expired. Attach the file again.' };
  return { ...base, phase: 'failed', error: 'This file is no longer available. Attach it again.' };
}

function fromState(item: LinkItem, state: UploadState): LinkItem {
  return {
    ...item,
    phase: state.phase,
    progress: state.total > 0 ? state.sent / state.total : 0,
    error: state.error,
    retryable: state.retryable,
    ref: state.link ? toFileLinkRef(state.link) : item.ref,
  };
}

let nextKey = 0;

export function useFileLinks(initial: FileLinkRef[] | undefined, onUnauthorized: () => void) {
  const [items, setItems] = useState<LinkItem[]>(() => (initial ?? []).map(restoredItem));
  const uploads = useRef(new Map<string, FileLinkUpload>());
  const onUnauthorizedRef = useRef(onUnauthorized);
  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  const update = useCallback((key: string, patch: (item: LinkItem) => LinkItem) => {
    setItems((prev) => prev.map((item) => (item.key === key ? patch(item) : item)));
  }, []);

  const add = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const added: LinkItem[] = files.map((file) => ({
        key: `link-${(nextKey += 1)}`,
        name: file.name,
        size: file.size,
        phase: 'starting',
        progress: 0,
        ref: null,
      }));
      setItems((prev) => [...prev, ...added]);
      added.forEach((item, index) => {
        const upload = new FileLinkUpload(
          files[index],
          (state) => update(item.key, (current) => fromState(current, state)),
          () => onUnauthorizedRef.current(),
        );
        uploads.current.set(item.key, upload);
        upload.start();
      });
    },
    [update],
  );

  // Read by remove(), so its side effects run once, outside a state updater
  // (React may call an updater twice).
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const remove = useCallback((key: string) => {
    const item = itemsRef.current.find((i) => i.key === key);
    const upload = uploads.current.get(key);
    if (upload) {
      // Never sent from here yet: cancel() takes it off the server too.
      upload.cancel();
      uploads.current.delete(key);
    } else if (item?.ref && !item.ref.sentAt && item.phase !== 'blocked') {
      // Restored but never sent: nothing else will ever use it, and it
      // counts against the mailbox's storage until it expires.
      void removeFileLink(item.ref.id, () => onUnauthorizedRef.current());
    }
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const retry = useCallback((key: string) => {
    uploads.current.get(key)?.start();
  }, []);

  // A restored link still being checked: wait for its verdict here too.
  const polling = useRef(new Set<string>());
  useEffect(() => {
    for (const item of items) {
      if (item.phase !== 'checking' || uploads.current.has(item.key) || !item.ref) continue;
      if (polling.current.has(item.key)) continue;
      polling.current.add(item.key);
      const { key } = item;
      const id = item.ref.id;
      void (async () => {
        for (let i = 0; i < 200; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const fresh = await getFileLink(id, () => onUnauthorizedRef.current());
          if (!fresh.success) continue;
          if (fresh.data.status !== 'scanning') {
            update(key, () => restoredItem(toFileLinkRef(fresh.data), 0));
            break;
          }
        }
        polling.current.delete(key);
      })();
    }
  }, [items, update]);

  // A window that goes away takes its unfinished uploads with it (and off
  // the server); finished links stay, for the draft that names them.
  useEffect(() => {
    const live = uploads.current;
    return () => {
      for (const upload of live.values()) {
        if (BUSY.has(upload.current.phase) || upload.current.phase === 'failed') upload.cancel();
      }
      live.clear();
    };
  }, []);

  const busy = items.some((item) => BUSY.has(item.phase));
  const uploading = items.filter((item) => BUSY.has(item.phase)).length;
  const failed = items.some((item) => item.phase === 'failed' || item.phase === 'blocked');
  /** What a send carries: only links that work. */
  const ready = useMemo(
    () => items.filter((item) => item.phase === 'ready' && item.ref).map((item) => item.ref!),
    [items],
  );
  /**
   * What a draft keeps: links whose file the server has whole (ready, or
   * still being checked). A half-finished upload cannot be resumed from a
   * draft -- the file itself is only in this window -- so it is not named.
   */
  const stored = useMemo(
    () =>
      items
        .filter((item) => item.ref && (item.phase === 'ready' || item.phase === 'checking'))
        .map((item) => item.ref!),
    [items],
  );

  return { items, add, remove, retry, busy, uploading, failed, ready, stored };
}

function statusText(item: LinkItem): string {
  switch (item.phase) {
    case 'starting':
      return 'Starting upload…';
    case 'uploading':
      return `Uploading ${Math.floor(item.progress * 100)}%`;
    case 'checking':
      return 'Checking for viruses…';
    case 'ready':
      return 'Download link';
    default:
      return item.error ?? 'Upload failed';
  }
}

export function FileLinkChips({
  items,
  ttlDays,
  onRemove,
  onRetry,
}: {
  items: LinkItem[];
  ttlDays?: number;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-border bg-pane px-3 py-2">
      <span className="text-[11px] text-muted-foreground">
        Too big to attach, so {items.length === 1 ? 'this file goes' : 'these files go'} as a download link
        {ttlDays ? ` that works for ${ttlDays} days.` : '.'}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((item) => {
          const problem = item.phase === 'failed' || item.phase === 'blocked';
          const working = BUSY.has(item.phase);
          return (
            <span
              key={item.key}
              className={`relative inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded-md py-1 pl-2 pr-1 text-[12px] ${
                problem ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground'
              }`}
              title={problem ? item.error : undefined}
            >
              {item.phase === 'blocked' ? (
                <ShieldAlert size={12} className="shrink-0" />
              ) : working ? (
                <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Link2 size={12} className="shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{item.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(item.size)}</span>
              <span className={`shrink-0 text-[11px] ${problem ? '' : 'text-muted-foreground'}`}>
                · {statusText(item)}
              </span>
              {item.phase === 'failed' && item.retryable && (
                <button
                  type="button"
                  onClick={() => onRetry(item.key)}
                  className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] font-semibold hover:bg-foreground/10"
                >
                  <RotateCw size={11} /> Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => onRemove(item.key)}
                className="shrink-0 rounded p-0.5 hover:bg-foreground/10"
                title={`Remove ${item.name}`}
                aria-label={`Remove ${item.name}`}
              >
                <X size={12} />
              </button>
              {item.phase === 'uploading' && (
                <span
                  aria-hidden
                  className="absolute bottom-0 left-0 h-[2px] bg-primary transition-[width] duration-300"
                  style={{ width: `${Math.max(2, Math.floor(item.progress * 100))}%` }}
                />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
