'use client';

import { useEffect, useRef, useState } from 'react';
import { attachmentPreviewUrl, type ApiFile } from '@/lib/webmail/client';

/**
 * What a file looks like, in the Files grid.
 *
 * Every non-image file used to show the same type glyph, so 76 documents were
 * 76 identical tiles and the only way to find one was to read filenames.
 *
 * Two kinds of document, two honest answers:
 *
 * - **PDF: its first page**, rasterised with the pdf.js already here for the
 *   viewer. A letterhead or an invoice layout is the thing people recognise.
 * - **Word: its opening lines.** There is no page image to rasterise -- and
 *   the obvious shortcut does not work: a .docx CAN carry a rendered
 *   `docProps/thumbnail.jpeg`, but only if the author ticked "Save Thumbnail",
 *   and none of five real-world files checked had one. So the tile shows the
 *   document's own first lines instead, which is what distinguishes "LETTER OF
 *   INTENT" from "SENIOR SOFTWARE ENGINEER" from "Total Budget: N5,225,000".
 *
 * The Word text comes straight out of the zip -- `word/document.xml`, the
 * `<w:t>` runs -- rather than through mammoth. mammoth converts a whole
 * document to HTML with styles and images, which is the right tool for the
 * viewer and far too much work for five lines on a tile.
 *
 * Spreadsheets and the rest keep their type tile. A thumbnail that is not
 * derived from the file teaches the reader nothing.
 *
 * Three things make this safe on a grid rather than one file at a time:
 *
 * - **Lazy.** Nothing is fetched until the tile is near the viewport. A grid of
 *   76 would otherwise download and parse 76 documents on load, when the
 *   reader can see six.
 * - **Throttled.** Two at a time. Rasterising a PDF is CPU work on the main
 *   thread's doorstep, and a dozen at once makes scrolling stutter.
 * - **Cached, module-level.** Scrolling back up must not redo the work. The
 *   cache outlives the component because the grid unmounts tiles as they
 *   leave.
 *
 * Failure is silent: an encrypted, corrupt, oversized or missing file falls
 * back to the type tile. A broken-thumbnail placeholder would be worse than
 * the icon it replaced.
 */

/** Past this a thumbnail is not worth the download; the tile stays an icon. */
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;
/** Rasterised width in CSS pixels. The tile is small; this is not a document viewer. */
const THUMBNAIL_WIDTH = 240;
/** Concurrent jobs. Two keeps scrolling smooth while still filling a screen quickly. */
const MAX_CONCURRENT = 2;
/** Lines of Word text worth showing. More than this and the tile is a wall. */
const DOCX_LINES = 7;

type Thumb = { kind: 'image'; src: string } | { kind: 'text'; lines: string[] } | null;

const cache = new Map<string, Thumb>();

let active = 0;
const queue: (() => void)[] = [];

function runWhenFree(task: () => Promise<void>) {
  const start = () => {
    active += 1;
    void task().finally(() => {
      active -= 1;
      queue.shift()?.();
    });
  };
  if (active < MAX_CONCURRENT) start();
  else queue.push(start);
}

async function renderPdf(bytes: ArrayBuffer): Promise<Thumb> {
  const pdfjs = await import('pdfjs-dist');
  // Copied into public/ by scripts/copy-pdf-worker.mjs, same as the viewer.
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  // slice(0) because pdf.js takes ownership of the buffer it is handed.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), enableXfa: false });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (THUMBNAIL_WIDTH / base.width) * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    // `canvas`, not `canvasContext` -- the viewer already uses the newer form.
    // `background` because a PDF page is transparent where it is white, and on
    // a dark tile its own text would otherwise land on the tile unreadably.
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    return { kind: 'image', src: canvas.toDataURL('image/jpeg', 0.72) };
  } finally {
    void task.destroy();
  }
}

async function renderDocx(bytes: ArrayBuffer): Promise<Thumb> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('word/document.xml');
  if (!entry) return null;
  const xml = await entry.async('string');

  const lines: string[] = [];
  // Paragraph by paragraph, so the document's own line breaks survive -- the
  // first paragraph is nearly always the title, and running the runs together
  // would lose exactly that.
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  for (const paragraph of paragraphs) {
    const text = (paragraph.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
      .map((run) => run.replace(/<[^>]+>/g, ''))
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    // Rules and spacer glyphs are a real thing in these documents -- one CV
    // opened with a line of em dashes -- and they say nothing on a tile.
    if (text.length < 2 || !/[\p{L}\p{N}]/u.test(text)) continue;
    lines.push(text);
    if (lines.length >= DOCX_LINES) break;
  }
  return lines.length ? { kind: 'text', lines } : null;
}

async function build(file: ApiFile, kind: 'pdf' | 'docx', signal: AbortSignal): Promise<Thumb> {
  const response = await fetch(attachmentPreviewUrl(file.message_id, file.index), { signal });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_THUMBNAIL_BYTES) return null;
  return kind === 'pdf' ? renderPdf(bytes) : renderDocx(bytes);
}

export default function FileThumbnail({
  file,
  kind,
  fallback,
}: {
  file: ApiFile;
  kind: 'pdf' | 'docx';
  fallback: React.ReactNode;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [thumb, setThumb] = useState<Thumb>(() => cache.get(file.id) ?? null);
  // Separate from `thumb` so a cached miss (null) does not look the same as
  // "not looked at yet".
  const [seen, setSeen] = useState(() => cache.has(file.id));

  useEffect(() => {
    if (seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      // A screen early, so a thumbnail is usually there by the time the tile is
      // looked at rather than appearing under the reader's eyes.
      { rootMargin: '600px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen || thumb !== null || cache.has(file.id)) return;
    const controller = new AbortController();
    let cancelled = false;
    runWhenFree(async () => {
      if (cancelled || controller.signal.aborted) return;
      let result: Thumb = null;
      try {
        result = await build(file, kind, controller.signal);
      } catch {
        // Encrypted, corrupt, or gone. The type tile stands in.
        result = null;
      }
      if (cancelled) return;
      cache.set(file.id, result);
      setThumb(result);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [seen, thumb, file, kind]);

  if (thumb?.kind === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a canvas data URL
      <img
        src={thumb.src}
        alt=""
        // Top-aligned, not centred: a page's identity is its header -- the
        // letterhead, the title, who it is from. Centring a tall page in a 4:3
        // tile shows its middle, which is body text and looks like every other
        // document.
        className="h-full w-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.02]"
      />
    );
  }

  if (thumb?.kind === 'text') {
    return (
      // Shaped like a page rather than a card: a white sheet in both themes,
      // because that is what a Word document looks like, and because the tile
      // then reads as the same KIND of thing as the PDF beside it.
      <span className="flex h-full w-full flex-col gap-[3px] overflow-hidden bg-white p-3 text-left transition-transform duration-200 group-hover:scale-[1.02]">
        {thumb.lines.map((line, i) => (
          <span
            key={i}
            className={
              i === 0
                ? 'line-clamp-2 font-serif text-[10px] font-bold leading-snug text-gray-900'
                : 'truncate font-serif text-[8.5px] leading-snug text-gray-600'
            }
          >
            {line}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span ref={hostRef} className="flex h-full w-full">
      {fallback}
    </span>
  );
}
