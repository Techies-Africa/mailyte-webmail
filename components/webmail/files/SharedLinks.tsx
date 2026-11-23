'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Unlink } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import ConfirmModal from '@/components/webmail/modals/ConfirmModal';
import { brand } from '@/lib/webmail/brand';
import { listFileLinks, removeFileLink, type ApiFileLink } from '@/lib/webmail/client';
import { useCapabilities } from '@/lib/webmail/query/accountQueries';
import { unwrap } from '@/lib/webmail/query/errors';
import { useUnauthorizedHandler } from '@/lib/webmail/query/session';

/**
 * Files this mailbox has sent as download links (the last 90 days): how often
 * each was downloaded, until when it works, and Stop sharing -- for the file
 * sent to the wrong person, or the wrong file. Shown only when the server
 * offers links and there is something to show.
 */

const KEY = ['mb', 'file-links'] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDay(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function stateText(file: ApiFileLink): string {
  switch (file.status) {
    case 'ready':
      return file.sent_at ? `Works until ${formatDay(file.expires_at)}` : 'Not sent yet';
    case 'scanning':
      return 'Being checked for viruses';
    case 'blocked':
      return 'Removed: a virus was found';
    case 'expired':
      return 'Expired';
    case 'removed':
      return file.removed_reason === 'operator' ? `Taken down by ${brand.name}` : 'You stopped sharing it';
    default:
      return 'Upload did not finish';
  }
}

export default function SharedLinks() {
  const enabled = useCapabilities().data?.file_links?.enabled === true;
  const onUnauthorized = useUnauthorizedHandler();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<ApiFileLink | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const files = useQuery({
    queryKey: KEY,
    queryFn: async () => unwrap(await listFileLinks(onUnauthorized))?.files ?? [],
    enabled,
    staleTime: 30_000,
  });

  const list = Array.isArray(files.data) ? files.data : [];
  if (!enabled || list.length === 0) return null;

  const copy = async (file: ApiFileLink) => {
    if (!file.url) return;
    try {
      await navigator.clipboard.writeText(file.url);
      setCopied(file.id);
      window.setTimeout(() => setCopied((id) => (id === file.id ? null : id)), 1500);
    } catch {
      toast("Couldn't copy the link", { tone: 'error' });
    }
  };

  const stop = async (file: ApiFileLink) => {
    const result = await removeFileLink(file.id, onUnauthorized);
    if (!result.success) {
      toast(`Couldn't stop sharing "${file.name}": ${result.message}`, { tone: 'error' });
      return;
    }
    toast(`"${file.name}" is no longer shared`);
    void queryClient.invalidateQueries({ queryKey: KEY });
  };

  return (
    <section aria-label="Shared as download links" className="border-b border-border px-3 py-3 sm:px-5 sm:py-4">
      <h2 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
        <Link2 size={13} /> Sent as download links
      </h2>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {list.map((file) => {
          const live = file.status === 'ready' || file.status === 'scanning';
          return (
            <li key={file.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
              <span className="shrink-0 text-muted-foreground">
                {file.download_count === 1 ? '1 download' : `${file.download_count} downloads`}
              </span>
              <span className={`shrink-0 ${live ? 'text-muted-foreground' : 'text-destructive'}`}>{stateText(file)}</span>
              {live && (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void copy(file)}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-primary hover:bg-primary/10"
                  >
                    {copied === file.id ? <Check size={12} /> : <Copy size={12} />}
                    {copied === file.id ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm(file)}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-destructive hover:bg-destructive/10"
                  >
                    <Unlink size={12} /> Stop sharing
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmModal
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) await stop(confirm);
          setConfirm(null);
        }}
        icon={<Unlink size={16} />}
        tone="danger"
        title="Stop sharing this file?"
        body={
          <>
            The link to <strong>{confirm?.name}</strong> stops working for everyone who has it, and the file is
            deleted. This can&apos;t be undone.
          </>
        }
        confirmLabel="Stop sharing"
      />
    </section>
  );
}
