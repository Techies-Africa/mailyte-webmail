'use client';

import { useEffect, useRef, useState } from 'react';
import { attachmentPreviewUrl, type ApiFile } from '@/lib/webmail/client';

/**
 * The first page of a PDF, drawn small, so the Files grid can be read by
 * looking at it.
 *
 * Every non-image file showed the same red PDF glyph, so a grid of 76
 * documents was 76 identical tiles and the only way to find one was to read
 * the filenames. A first page is the thing people actually recognise -- a
 * letterhead, an invoice layout, a signature block.
 *
 * PDF only, deliberately. pdf.js rasterises a page, which is what a thumbnail
 * is. docx and xlsx have no page image to rasterise -- mammoth and the xlsx
 * reader produce HTML and cells, not a rendering -- so a "thumbnail" for those
 * would be a picture of something the file does not look like. They keep their
 * type tile, which at least does not mislead.
 *
 * Three things make this safe to do on a grid rather than one file at a time:
 *
 * - **Lazy.** Nothing is fetched until the tile is near the viewport. A grid
 *   of 76 PDFs would otherwise download and rasterise 76 documents on load,
 *   when the reader can see six.
 * - **Throttled.** Two at a time. pdf.js rasterising is CPU work on the main
 *   thread's doorstep, and a dozen at once makes scrolling stutter on the
 *   machine doing it.
 * - **Cached, module-level.** Scrolling back up must not re-fetch and re-draw
 *   what was already drawn. The cache outlives the component because the grid
 *   unmounts tiles as they leave.
 *
 * Failure is silent on purpose: an encrypted, corrupt or unusually large PDF
 * falls back to the type tile. A broken-thumbnail placeholder would be worse
 * than the icon it replaced.
 */

/** Past this a thumbnail is not worth the download; the tile stays an icon. */
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;
/** Rasterised width in CSS pixels. The tile is small; the page is not a document here. */
const THUMBNAIL_WIDTH = 240;
/** Concurrent rasterisations. Two keeps scrolling smooth while still filling a screen quickly. */
const MAX_CONCURRENT = 2;

const cache = new Map<string, string | null>();

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

async function renderFirstPage(file: ApiFile, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(attachmentPreviewUrl(file.message_id, file.index), { signal });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_THUMBNAIL_BYTES) return null;

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
    // `canvas`, not `canvasContext` -- the viewer already uses the newer form
    // and pdf.js takes the context itself.
    //
    // `background` because a PDF page is transparent where it is white, and in
    // dark mode this is drawn onto a dark tile: without it the page's own text
    // renders straight onto the tile and is unreadable. Painting white here
    // rather than before render, since pdf.js owns the canvas once it has it.
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    return canvas.toDataURL('image/jpeg', 0.72);
  } finally {
    void task.destroy();
  }
}

export default function PdfThumbnail({
  file,
  fallback,
}: {
  file: ApiFile;
  fallback: React.ReactNode;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(() => cache.get(file.id) ?? null);
  // Only once the tile has been near the viewport. Separate from `src` so a
  // cached miss (null) does not look the same as "not looked at yet".
  const [seen, setSeen] = useState(() => cache.has(file.id));

  useEffect(() => {
    if (seen || typeof IntersectionObserver === 'undefined') {
      if (typeof IntersectionObserver === 'undefined') setSeen(true);
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
      // Start a screen early, so a thumbnail is usually there by the time the
      // tile is looked at rather than appearing under the reader's eyes.
      { rootMargin: '600px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen || src !== null || cache.has(file.id)) return;
    const controller = new AbortController();
    let cancelled = false;
    runWhenFree(async () => {
      if (cancelled || controller.signal.aborted) return;
      let result: string | null = null;
      try {
        result = await renderFirstPage(file, controller.signal);
      } catch {
        // Encrypted, corrupt, or gone. The type tile stands in.
        result = null;
      }
      if (cancelled) return;
      cache.set(file.id, result);
      if (result) setSrc(result);
      else setSrc(null);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [seen, src, file]);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a canvas data URL
      <img
        src={src}
        alt=""
        // Top-aligned, not centred: a page's identity is its header -- the
        // letterhead, the title, who it is from. Centring a tall page in a 4:3
        // tile shows its middle, which is body text and looks like every other
        // document.
        className="h-full w-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.02]"
      />
    );
  }

  return (
    <span ref={hostRef} className="flex h-full w-full">
      {fallback}
    </span>
  );
}
