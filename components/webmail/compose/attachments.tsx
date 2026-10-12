'use client';

import { useEffect, useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import IconButton from '@/components/ui/IconButton';
import { isAcceptedImage } from '@/lib/webmail/images';

/** Matches SendMailboxMessageRequest's own limits. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A drag that carries files from the desktop -- not text or a link moved inside the editor. */
function carriesFiles(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types).includes('Files');
}

/**
 * The files in a drop, folders left out and counted. A dropped folder arrives
 * as an empty "file" that passes every check here and then fails the send.
 */
function droppedFiles(data: DataTransfer): { files: File[]; folders: number } {
  const files: File[] = [];
  let folders = 0;
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    if (item.webkitGetAsEntry()?.isDirectory) {
      folders += 1;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, folders };
}

/**
 * Picking files, dropping them, the limits and the chips -- shared by the
 * full compose window and the inline reply card.
 *
 * Both hosts send the same ComposePayload, and the wire already switches to
 * multipart whenever `attachments` is non-empty (sendMessage in client.ts), so
 * a host only has to fill that one field.
 *
 * Errors are handed back rather than rendered: each host already has its own
 * error bar, and a file that is too big belongs in the same one as a failed
 * send.
 *
 * Dropping (2026-10-07): a host spreads `dropProps` on its root and shows
 * <DropOverlay /> while `dragging`. Pictures dropped onto the text go inline,
 * Gmail-style -- WebmailEditor's handleDrop puts them there -- and every other
 * file, and a picture dropped anywhere else on the host, is attached through
 * addFiles, so a drop meets the same limits as the paperclip. While a host is
 * on screen, a file dropped beside it is refused rather than opened in the
 * tab, which would take the message being written with it.
 */
export function useAttachments(initial: File[], onError: (message: string | null) => void) {
  const [attachments, setAttachments] = useState<File[]>(initial);
  const attachedBytes = attachments.reduce((sum, file) => sum + file.size, 0);

  const addFiles = (files: FileList | File[] | null) => {
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

  const [dragging, setDragging] = useState(false);
  // dragenter and dragleave fire for every child the pointer crosses; the
  // depth says when it has really left the host.
  const depth = useRef(0);

  useEffect(() => {
    const refuse = (event: DragEvent) => {
      if (event.defaultPrevented || !carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', refuse);
    window.addEventListener('drop', refuse);
    return () => {
      window.removeEventListener('dragover', refuse);
      window.removeEventListener('drop', refuse);
    };
  }, []);

  const dropProps = {
    onDragEnter: (event: React.DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      // Without this the drop never fires and the browser opens the file.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (event: React.DragEvent) => {
      depth.current = 0;
      setDragging(false);
      if (!carriesFiles(event.dataTransfer)) return;
      // Already handled = the editor took it (WebmailEditor's handleDrop) and
      // put the pictures inline. ProseMirror only asks it when the drop point
      // maps into the text; anywhere else, everything is attached. Read
      // before this handler's own preventDefault below.
      const editorTookIt = event.nativeEvent.defaultPrevented;
      event.preventDefault();
      const { files, folders } = droppedFiles(event.dataTransfer);
      addFiles(editorTookIt ? files.filter((file) => !isAcceptedImage(file)) : files);
      if (folders > 0) onError("Folders can't be attached. Zip the folder, then drop the .zip.");
    },
  };

  return { attachments, attachedBytes, addFiles, removeAt, dragging, dropProps };
}

/**
 * Over a compose host while files are dragged across it. It takes no pointer
 * events, so a drop still lands on what is underneath -- which is how a
 * picture let go over the text still goes inline.
 */
export function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-primary bg-primary/5">
      <span className="rounded-full bg-card px-3 py-1.5 text-[12.5px] font-semibold text-primary shadow-sm">
        Drop files here
      </span>
    </div>
  );
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
