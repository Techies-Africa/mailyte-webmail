'use client';

import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Download, LoaderCircle } from 'lucide-react';
import { formatBytes } from '@/components/webmail/compose/attachments';
import { attachmentPreviewUrl, attachmentUrl, type ApiFile } from '@/lib/webmail/client';
import { extensionOf, INLINE_IMAGE, kindStyle } from './fileMeta';

/**
 * A file drawn inside the page, the way Google Drive and Zoho show one --
 * never a new tab.
 *
 * What the browser can show by itself (pictures, audio, video) comes through
 * the attachment proxy's inline preview. Everything else is fetched as bytes
 * and drawn by code that cannot run what the file contains:
 *
 *   PDF          pdf.js onto canvases (its scripting is never loaded)
 *   Word .docx   mammoth -> plain HTML -> DOMPurify -> a sandboxed frame
 *                with no script permission at all
 *   Excel .xlsx  read-excel-file -> cell values as text in a table
 *   .zip         jszip -> the list of what is inside
 *   text, CSV    text, or a table
 *
 * A sender's document is never rendered as live HTML on this origin: that
 * would be stored XSS (the proxy's own rule, PRD SS7.6).
 */

/** Past this, a preview would stall the tab; the file downloads instead. */
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_PDF_PAGES = 60;

type Renderer = 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'csv' | 'docx' | 'xlsx' | 'zip' | 'none';

export function rendererFor(file: Pick<ApiFile, 'name' | 'type'>): Renderer {
  const type = file.type.split(';')[0].trim().toLowerCase();
  const ext = (extensionOf(file.name) ?? '').toLowerCase();
  if (INLINE_IMAGE.test(type)) return 'image';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/^audio\/(mpeg|mp4|ogg|wav|webm)$/.test(type)) return 'audio';
  if (/^video\/(mp4|webm|ogg)$/.test(type)) return 'video';
  if (type === 'text/csv' || ext === 'csv') return 'csv';
  if (type === 'text/plain' || type === 'application/json' || ['txt', 'log', 'md', 'json'].includes(ext)) return 'text';
  if (ext === 'docx' || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (ext === 'xlsx' || type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (ext === 'zip' || type === 'application/zip' || type === 'application/x-zip-compressed') return 'zip';
  return 'none';
}

export default function FilePreview({ file }: { file: ApiFile }) {
  const renderer = rendererFor(file);
  const inline = attachmentPreviewUrl(file.message_id, file.index);

  if (renderer === 'image') return <ImagePreview key={file.id} src={inline} name={file.name} />;
  if (renderer === 'audio')
    return (
      <Centered>
        <audio key={file.id} controls src={inline} className="w-full max-w-lg" />
      </Centered>
    );
  if (renderer === 'video')
    return (
      <Centered>
        <video key={file.id} controls src={inline} className="max-h-full max-w-full rounded-lg bg-black" />
      </Centered>
    );
  if (renderer === 'none' || file.size > MAX_PREVIEW_BYTES) return <NoPreview file={file} tooBig={renderer !== 'none'} />;
  return <FetchedPreview key={file.id} file={file} renderer={renderer} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center p-4">{children}</div>;
}

function ImagePreview({ src, name }: { src: string; name: string }) {
  // Fitted to the screen; a click shows it at its real size, scrollable.
  const [actual, setActual] = useState(false);
  return (
    <div className={`h-full w-full ${actual ? 'overflow-auto' : 'flex items-center justify-center p-4'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin attachment */}
      <img
        src={src}
        alt={name}
        onClick={() => setActual((v) => !v)}
        className={actual ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'}
      />
    </div>
  );
}

export function NoPreview({ file, tooBig = false }: { file: ApiFile; tooBig?: boolean }) {
  const style = kindStyle(file.kind);
  return (
    <Centered>
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-white/[0.06] px-8 py-8 text-center text-white">
        <span className={`flex h-16 w-16 items-center justify-center rounded-2xl [&>svg]:h-8 [&>svg]:w-8 ${style.tint}`}>
          {style.icon}
        </span>
        <p className="break-all text-[14px] font-semibold">{file.name}</p>
        <p className="text-[12.5px] text-white/60">
          {tooBig
            ? `${formatBytes(file.size)} is too large to preview here.`
            : 'There is no preview for this kind of file.'}
        </p>
        <a
          href={attachmentUrl(file.message_id, file.index)}
          download={file.name}
          className="mt-1 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Download size={14} />
          Download · {formatBytes(file.size)}
        </a>
      </div>
    </Centered>
  );
}

type Loaded =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'text'; text: string; truncated: boolean }
  | { state: 'table'; sheets: { name: string; rows: string[][]; truncated: boolean }[] }
  | { state: 'html'; html: string }
  | { state: 'zip'; entries: { name: string; size: number }[] }
  | { state: 'pdf'; bytes: ArrayBuffer };

function FetchedPreview({ file, renderer }: { file: ApiFile; renderer: Renderer }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const res = await fetch(attachmentUrl(file.message_id, file.index), { signal: controller.signal });
      if (!res.ok) throw new Error('This file could not be loaded.');
      const bytes = await res.arrayBuffer();
      if (renderer === 'pdf') return { state: 'pdf', bytes } as Loaded;
      if (renderer === 'text' || renderer === 'csv') {
        const truncated = bytes.byteLength > MAX_TEXT_BYTES;
        const text = new TextDecoder('utf-8').decode(bytes.slice(0, MAX_TEXT_BYTES));
        if (renderer === 'text') return { state: 'text', text, truncated } as Loaded;
        const rows = parseCsv(text);
        return { state: 'table', sheets: [{ name: file.name, rows: rows.slice(0, MAX_ROWS), truncated: truncated || rows.length > MAX_ROWS }] } as Loaded;
      }
      if (renderer === 'docx') {
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
        return { state: 'html', html: DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } }) } as Loaded;
      }
      if (renderer === 'xlsx') {
        const readXlsxFile = (await import('read-excel-file/browser')).default;
        const sheets = await readXlsxFile(bytes);
        return {
          state: 'table',
          sheets: sheets.map((s) => ({
            name: s.sheet,
            rows: s.data.slice(0, MAX_ROWS).map((row) => row.map(cellText)),
            truncated: s.data.length > MAX_ROWS,
          })),
        } as Loaded;
      }
      if (renderer === 'zip') {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(bytes);
        const entries: { name: string; size: number }[] = [];
        zip.forEach((path, entry) => {
          if (!entry.dir) {
            // Uncompressed size, read without inflating anything.
            const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
            entries.push({ name: path, size });
          }
        });
        return { state: 'zip', entries: entries.sort((a, b) => a.name.localeCompare(b.name)) } as Loaded;
      }
      return { state: 'failed', message: 'There is no preview for this kind of file.' } as Loaded;
    })()
      .then((next) => {
        if (!controller.signal.aborted) setLoaded(next);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoaded({ state: 'failed', message: err instanceof Error && err.message ? err.message : 'This file could not be shown.' });
      });
    return () => controller.abort();
  }, [file, renderer]);

  if (loaded.state === 'loading') {
    return (
      <Centered>
        <LoaderCircle size={26} className="animate-spin text-white/60" aria-label="Loading preview" />
      </Centered>
    );
  }
  if (loaded.state === 'failed') {
    return (
      <div className="flex h-full flex-col">
        <p className="bg-destructive/20 px-4 py-2 text-center text-[12.5px] text-white">
          This file could not be previewed{loaded.message ? `: ${loaded.message}` : '.'}
        </p>
        <div className="flex-1">
          <NoPreview file={file} />
        </div>
      </div>
    );
  }
  if (loaded.state === 'pdf') return <PdfPreview bytes={loaded.bytes} />;
  if (loaded.state === 'text') {
    return (
      <div className="h-full overflow-auto p-3 sm:p-6">
        <pre className="mx-auto max-w-4xl whitespace-pre-wrap break-words rounded-lg bg-card p-5 font-mono text-[12.5px] leading-relaxed text-foreground">
          {loaded.text}
        </pre>
        {loaded.truncated && <Truncated what="the first 2 MB" />}
      </div>
    );
  }
  if (loaded.state === 'html') return <DocumentPreview html={loaded.html} />;
  if (loaded.state === 'zip') {
    return (
      <div className="h-full overflow-auto p-3 sm:p-6">
        <div className="mx-auto max-w-2xl rounded-lg bg-card">
          <p className="border-b border-border px-4 py-2.5 text-[12px] font-semibold text-muted-foreground">
            {loaded.entries.length} file{loaded.entries.length === 1 ? '' : 's'} inside
          </p>
          <ul className="divide-y divide-border">
            {loaded.entries.map((entry) => (
              <li key={entry.name} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate font-mono text-foreground">{entry.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(entry.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return <SheetPreview sheets={loaded.sheets} />;
}

function Truncated({ what }: { what: string }) {
  return <p className="mx-auto mt-3 max-w-4xl text-center text-[12px] text-white/60">Showing {what}. Download the file to see all of it.</p>;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function SheetPreview({ sheets }: { sheets: { name: string; rows: string[][]; truncated: boolean }[] }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  if (!sheet) return <Centered><p className="text-white/70">This spreadsheet is empty.</p></Centered>;
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  // Centred while it fits; a wide sheet scrolls sideways from its first column.
  return (
    <div className="h-full overflow-auto p-3 sm:p-6">
      <div className="mx-auto w-fit max-w-full">
        {sheets.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {sheets.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={i === active}
                className={`shrink-0 rounded-t-md px-3 py-1.5 text-[12px] font-medium ${
                  i === active ? 'bg-card text-foreground' : 'bg-white/10 text-white/70 hover:bg-white/15'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="border-collapse bg-card text-[12px] text-foreground">
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r} className={r === 0 ? 'bg-muted font-semibold' : ''}>
                  <td className="sticky left-0 border border-border bg-muted px-2 py-1 text-right text-[10.5px] text-muted-foreground">{r + 1}</td>
                  {Array.from({ length: width }, (_, c) => (
                    <td key={c} className="max-w-[320px] truncate border border-border px-2 py-1" title={row[c] ?? ''}>
                      {row[c] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sheet.truncated && <Truncated what={`the first ${MAX_ROWS.toLocaleString('en-US')} rows`} />}
      </div>
    </div>
  );
}

/**
 * A Word document's HTML, in a frame with an empty sandbox: no script, no
 * same-origin access, no forms, no navigation of this page. DOMPurify has
 * already taken out anything active; the sandbox holds even if it missed.
 */
function DocumentPreview({ html }: { html: string }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:48px 56px;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#18181b;background:#fff;word-wrap:break-word}
    img{max-width:100%;height:auto} table{border-collapse:collapse;max-width:100%} td,th{border:1px solid #e4e4e7;padding:4px 8px;vertical-align:top}
    h1,h2,h3{line-height:1.25} a{color:#3730a3}
  </style></head><body>${html}</body></html>`;
  return (
    <div className="h-full overflow-hidden p-3 sm:p-6">
      <iframe
        title="Document preview"
        sandbox=""
        srcDoc={doc}
        className="mx-auto block h-full w-full max-w-4xl rounded-lg bg-white shadow-panel"
      />
    </div>
  );
}

/** Every page (up to a limit) drawn by pdf.js, fitted to the width. */
function PdfPreview({ bytes }: { bytes: ArrayBuffer }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<{ pages: number; shown: number } | { error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      // Copied into public/ by scripts/copy-pdf-worker.mjs.
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), enableXfa: false });
      destroy = () => void task.destroy();
      const pdf = await task.promise;
      const host = hostRef.current;
      if (cancelled || !host) return;
      const shown = Math.min(pdf.numPages, MAX_PDF_PAGES);
      setStatus({ pages: pdf.numPages, shown });
      const width = Math.min(host.clientWidth - 24, 900);
      const ratio = window.devicePixelRatio || 1;
      for (let n = 1; n <= shown && !cancelled; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
        canvas.className = 'mx-auto mb-3 block rounded-sm bg-white shadow-panel';
        canvas.setAttribute('aria-label', `Page ${n} of ${pdf.numPages}`);
        canvas.setAttribute('role', 'img');
        host.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
      }
    })().catch((err) => {
      if (!cancelled) setStatus({ error: err instanceof Error ? err.message : 'This PDF could not be shown.' });
    });
    return () => {
      cancelled = true;
      destroy?.();
      hostRef.current?.replaceChildren();
    };
  }, [bytes]);

  return (
    <div className="h-full overflow-auto px-3 py-4 sm:px-6">
      {status && 'error' in status && (
        <p className="mb-3 text-center text-[12.5px] text-white/70">This PDF could not be shown: {status.error}</p>
      )}
      {!status && (
        <div className="flex justify-center py-10">
          <LoaderCircle size={26} className="animate-spin text-white/60" aria-label="Loading PDF" />
        </div>
      )}
      <div ref={hostRef} />
      {status && 'shown' in status && status.shown < status.pages && (
        <Truncated what={`the first ${status.shown} of ${status.pages} pages`} />
      )}
    </div>
  );
}
