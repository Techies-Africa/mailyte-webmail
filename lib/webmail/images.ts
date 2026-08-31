// Turning a picked or pasted image file into something the editor can hold.
//
// The editor embeds pictures as data: URIs -- there is no upload endpoint for
// mailbox assets and, for email, none is wanted: a remote image is blocked by
// every client until the reader opts in, whereas an embedded one is shown.
// (On send the mail server turns each data: image into a Content-ID part, so
// Gmail and Outlook -- which refuse data: URIs -- display it too.)
//
// Embedding means the bytes travel inside the HTML, so size matters twice:
// the signature is stored on every message it goes out on, and the message
// body has to fit through the API. Hence the scaling here: nothing needs a
// 4000px camera photo in a mail body, and a banner card looks the same at
// 1200px as it does at 3000px.

/** After encoding. The server's signature ceiling is 2 MB; keep well under it. */
export const MAX_IMAGE_BYTES = 1024 * 1024;

/** Longest edge after scaling. Wider than any mail client renders a body. */
const MAX_EDGE = 1200;

const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** For the file input's accept attribute -- the same list, in one place. */
export const ACCEPTED_IMAGE_TYPES = ACCEPTED.join(',');

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED.includes(file.type);
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The file is not a readable image'));
    img.src = src;
  });
}

function encode(img: HTMLImageElement, scale: number, type: string, quality: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not resize the image');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, quality);
}

function formatKb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The file as a data: URI no larger than MAX_IMAGE_BYTES, scaled down where
 * that is what it takes. Throws with a sentence fit to show the user.
 *
 * GIFs are never re-encoded -- a canvas keeps only the first frame, and
 * someone inserting a GIF wants it to move -- so a large one is refused
 * rather than silently frozen.
 */
export async function imageFileToDataUrl(file: File): Promise<string> {
  if (!isAcceptedImage(file)) {
    throw new Error(`"${file.name}" is not a PNG, JPEG, GIF or WebP image.`);
  }

  const original = await readAsDataUrl(file);

  if (file.type === 'image/gif') {
    if (original.length > MAX_IMAGE_BYTES) {
      throw new Error(
        `"${file.name}" is ${formatKb(file.size)} — GIFs are inserted as-is, and the limit is 1 MB.`,
      );
    }
    return original;
  }

  const img = await loadImage(original);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;

  // Small and already within bounds: keep the bytes exactly as they are.
  if (scale === 1 && original.length <= MAX_IMAGE_BYTES) return original;

  // PNG stays PNG so a logo keeps its transparency; anything else is a
  // photo-like image and JPEG is the right container for it.
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const scaled = encode(img, scale, type, 0.85);
  if (scaled.length <= MAX_IMAGE_BYTES) return scaled;

  // Still too big: a PNG photo, typically. JPEG at a smaller size is the last
  // resort before giving up -- transparency is lost, but the picture goes in.
  const smaller = encode(img, scale * 0.6, 'image/jpeg', 0.8);
  if (smaller.length <= MAX_IMAGE_BYTES) return smaller;

  throw new Error(`"${file.name}" is too large to embed, even after resizing — the limit is 1 MB.`);
}
