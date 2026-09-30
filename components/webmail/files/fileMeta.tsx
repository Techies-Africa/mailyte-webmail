import { File, FileArchive, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation } from 'lucide-react';
import type { ApiFile, FileKind } from '@/lib/webmail/client';

/** Everything the Files screens say about a file besides its bytes. */

export const KIND_LABEL: Record<FileKind, string> = {
  images: 'Images',
  pdfs: 'PDFs',
  documents: 'Documents',
  spreadsheets: 'Spreadsheets',
  presentations: 'Slides',
  archives: 'Zip files',
  media: 'Audio & video',
  other: 'Other',
};

export const KIND_ORDER: FileKind[] = [
  'images',
  'pdfs',
  'documents',
  'spreadsheets',
  'presentations',
  'archives',
  'media',
  'other',
];

/** The icon tile for a type. UI identity only -- the overview's bars stay one hue. */
export const KIND_STYLE: Record<FileKind, { icon: React.ReactNode; tint: string }> = {
  images: { icon: <FileImage />, tint: 'bg-[hsl(280_65%_62%/0.14)] text-[hsl(280_55%_52%)]' },
  pdfs: { icon: <FileText />, tint: 'bg-destructive/[0.12] text-destructive' },
  documents: { icon: <FileText />, tint: 'bg-primary/10 text-primary' },
  spreadsheets: { icon: <FileSpreadsheet />, tint: 'bg-success/[0.12] text-success' },
  presentations: { icon: <Presentation />, tint: 'bg-warning/[0.14] text-warning' },
  archives: { icon: <FileArchive />, tint: 'bg-muted text-muted-foreground' },
  media: { icon: <FileVideo />, tint: 'bg-[hsl(200_75%_55%/0.14)] text-[hsl(200_70%_42%)]' },
  other: { icon: <File />, tint: 'bg-muted text-muted-foreground' },
};

export function kindStyle(kind: FileKind) {
  return KIND_STYLE[kind] ?? KIND_STYLE.other;
}

/** The email a file came in, opened in the inbox. */
export function emailHref(file: Pick<ApiFile, 'folder' | 'message_id'>): string {
  const params = new URLSearchParams();
  if (file.folder !== 'INBOX') params.set('folder', file.folder);
  params.set('id', file.message_id);
  return `/?${params}`;
}

/** Who the file is "with": the sender, or for a sent file the recipient. */
export function counterpartOf(file: ApiFile): string {
  if (file.direction === 'sent') {
    const to = file.to?.name?.trim() || file.to?.email;
    return to ? `To ${to}` : 'Sent';
  }
  return file.from.name?.trim() || file.from.email || 'Unknown sender';
}

export function extensionOf(name: string): string | null {
  return name.includes('.') ? name.split('.').pop()!.slice(0, 5).toUpperCase() : null;
}

/**
 * Raster types the attachment proxy serves inline, so the browser can draw
 * them from the file itself. Never SVG, which can carry script.
 */
export const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;

/** "1,284" -- a count as people read it. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

const EXTENSION_KIND: Record<string, FileKind> = {
  ...Object.fromEntries(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'svg'].map((e) => [e, 'images'])),
  pdf: 'pdfs',
  ...Object.fromEntries(['doc', 'docx', 'odt', 'rtf', 'txt', 'pages', 'md'].map((e) => [e, 'documents'])),
  ...Object.fromEntries(['xls', 'xlsx', 'xlsm', 'csv', 'ods', 'numbers', 'tsv'].map((e) => [e, 'spreadsheets'])),
  ...Object.fromEntries(['ppt', 'pptx', 'odp', 'key'].map((e) => [e, 'presentations'])),
  ...Object.fromEntries(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'].map((e) => [e, 'archives'])),
  ...Object.fromEntries(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'mp4', 'mov', 'avi', 'mkv', 'webm'].map((e) => [e, 'media'])),
} as Record<string, FileKind>;

/** The same rule as the mail server's kind_of (shared/bodystructure.py). */
export function kindOf(name: string, type: string): FileKind {
  const ext = (extensionOf(name) ?? '').toLowerCase();
  if (EXTENSION_KIND[ext]) return EXTENSION_KIND[ext];
  const t = type.toLowerCase();
  if (t.startsWith('image/')) return 'images';
  if (t === 'application/pdf') return 'pdfs';
  if (t.startsWith('audio/') || t.startsWith('video/')) return 'media';
  return 'other';
}

/** An open email's attachments as viewer files, so the reading pane opens them in place. */
export function filesOfMessage(
  message: { id: string; folder: string; subject: string; from: string; fromEmail: string; receivedAt: Date | null },
  attachments: { index: number; name: string; type: string; size: number }[],
): ApiFile[] {
  return attachments.map((a) => ({
    id: `${message.id}#${a.index}`,
    message_id: message.id,
    folder: message.folder,
    index: a.index,
    name: a.name,
    type: a.type,
    kind: kindOf(a.name, a.type),
    size: a.size,
    subject: message.subject,
    from: { name: message.from || null, email: message.fromEmail || null },
    received_at: message.receivedAt ? message.receivedAt.toISOString() : null,
  }));
}
