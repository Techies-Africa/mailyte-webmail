'use client';

import { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import IconButton from '@/components/ui/IconButton';

/** Matches SendMailboxMessageRequest's own limits. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Picking files, the limits and the chips -- shared by the full compose window
 * and the inline reply card.
 *
 * Both hosts send the same ComposePayload, and the wire already switches to
 * multipart whenever `attachments` is non-empty (sendMessage in client.ts), so
 * a host only has to fill that one field.
 *
 * Errors are handed back rather than rendered: each host already has its own
 * error bar, and a file that is too big belongs in the same one as a failed
 * send.
 */
export function useAttachments(initial: File[], onError: (message: string | null) => void) {
  const [attachments, setAttachments] = useState<File[]>(initial);
  const attachedBytes = attachments.reduce((sum, file) => sum + file.size, 0);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onError(null);
    const incoming = Array.from(files);
    const tooBig = incoming.find((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      onError(`"${tooBig.name}" is ${formatBytes(tooBig.size)} — the limit is 25 MB per file.`);
      return;
    }
    if (attachments.length + incoming.length > MAX_ATTACHMENTS) {
      onError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    if (attachedBytes + incoming.reduce((s, f) => s + f.size, 0) > MAX_ATTACHMENT_BYTES) {
      onError('Attachments total more than 25 MB.');
      return;
    }
    setAttachments((prev) => [...prev, ...incoming]);
  };

  const removeAt = (index: number) => setAttachments((prev) => prev.filter((_, i) => i !== index));

  return { attachments, attachedBytes, addFiles, removeAt };
}

/** The paperclip and the file input it opens. */
export function AttachButton({ onFiles }: { onFiles: (files: FileList | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <IconButton label="Attach files" size="md" onClick={() => inputRef.current?.click()}>
        <Paperclip size={14} />
      </IconButton>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          // Lets the same file be picked again after it was removed.
          e.target.value = '';
        }}
      />
    </>
  );
}

export function AttachmentChips({
  files,
  totalBytes,
  onRemove,
}: {
  files: File[];
  totalBytes: number;
  onRemove: (index: number) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border bg-pane px-3 py-2">
      {files.map((file, index) => (
        <span
          key={`${file.name}-${index}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted py-1 pl-2 pr-1 text-[12px] text-foreground"
        >
          <Paperclip size={12} className="shrink-0 text-muted-foreground" />
          <span className="truncate">{file.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(file.size)}</span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="shrink-0 rounded p-0.5 hover:bg-foreground/10"
            title={`Remove ${file.name}`}
            aria-label={`Remove ${file.name}`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <span className="self-center text-[11px] text-muted-foreground">{formatBytes(totalBytes)} of 25 MB</span>
    </div>
  );
}
