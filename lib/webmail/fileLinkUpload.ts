import {
  completeFileLink,
  createFileLink,
  getFileLink,
  removeFileLink,
  signFileLinkParts,
  type ApiFileLink,
} from './client';

/**
 * One file going up to be shared as a download link (owner, 2026-11-23).
 *
 * The file goes from this browser straight to storage, cut into parts (16 MB
 * each by default), three at a time. That is what makes a big file survive a
 * weak connection:
 *
 * - No single request carries more than one part, so no server time limit
 *   (Traefik's, Node's) can cut the upload off half way.
 * - A part that fails is sent again on its own, after a pause that grows with
 *   each try, and waits for the browser to be back online first.
 * - A part that stops moving for a minute is dropped and sent again, rather
 *   than hanging until someone gives up.
 * - Retry after a failure carries on from the parts already stored.
 *
 * Once every part is stored the server joins them and checks the file for
 * viruses; this then waits for the verdict.
 */

export type UploadPhase = 'starting' | 'uploading' | 'checking' | 'ready' | 'failed' | 'blocked';

export interface UploadState {
  phase: UploadPhase;
  /** Bytes stored so far, counting parts still on their way. */
  sent: number;
  total: number;
  link: ApiFileLink | null;
  error?: string;
  /** False when trying again would only fail the same way (a limit, a refusal). */
  retryable?: boolean;
}

const CONCURRENCY = 3;
const SIGN_BATCH = 20;
const MAX_PART_ATTEMPTS = 8;
/** Signed URLs last an hour; one older than this is signed again first. */
const URL_MAX_AGE_MS = 50 * 60 * 1000;
const STALL_MS = 60_000;

class StopError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function waitUntilOnline(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }));
}

/** A refusal from our own server: retrying helps only when it was not reached or was busy. */
function serverStop(result: { message: string; status?: number }): StopError {
  const status = result.status ?? 0;
  const retryable = status === 0 || status >= 500;
  return new StopError(
    status === 0 ? 'The upload stopped. Check your connection, then try again.' : result.message,
    retryable,
  );
}

type PartFailure = { kind: 'retry' } | { kind: 'resign' } | { kind: 'stop'; message: string };

export class FileLinkUpload {
  private link: ApiFileLink | null = null;
  private readonly etags = new Map<number, string>();
  private readonly inFlight = new Map<number, number>();
  private readonly urls = new Map<number, { url: string; at: number }>();
  private readonly requests = new Set<XMLHttpRequest>();
  private cancelled = false;
  private running = false;
  private state: UploadState;

  constructor(
    readonly file: File,
    private readonly onState: (state: UploadState) => void,
    private readonly onUnauthorized: () => void,
  ) {
    this.state = { phase: 'starting', sent: 0, total: file.size, link: null };
  }

  get current(): UploadState {
    return this.state;
  }

  start(): void {
    if (this.running || this.cancelled) return;
    if (this.state.phase === 'ready' || this.state.phase === 'blocked') return;
    this.running = true;
    void this.run().finally(() => {
      this.running = false;
    });
  }

  /** Stop and take the file back off the server. Nothing is left behind. */
  cancel(): void {
    this.cancelled = true;
    for (const xhr of this.requests) xhr.abort();
    this.requests.clear();
    if (this.link) void removeFileLink(this.link.id, this.onUnauthorized);
  }

  private set(patch: Partial<UploadState>) {
    if (this.cancelled) return;
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  private stored(): number {
    if (!this.link) return 0;
    let bytes = 0;
    for (const n of this.etags.keys()) bytes += this.partSize(n);
    for (const value of this.inFlight.values()) bytes += value;
    return Math.min(bytes, this.file.size);
  }

  private partSize(n: number): number {
    const partBytes = this.link!.part_bytes;
    return Math.min(partBytes, this.file.size - (n - 1) * partBytes);
  }

  private async run(): Promise<void> {
    try {
      this.set({ phase: this.link ? 'uploading' : 'starting', error: undefined, retryable: undefined });
      if (!this.link) {
        const created = await createFileLink(
          { name: this.file.name, size: this.file.size, content_type: this.file.type || 'application/octet-stream' },
          this.onUnauthorized,
        );
        if (!created.success) throw serverStop(created);
        this.link = created.data;
      }
      if (this.cancelled) return;
      this.set({ phase: 'uploading', link: this.link, sent: this.stored() });

      await this.uploadParts();
      if (this.cancelled) return;

      let finished: ApiFileLink | null = null;
      for (let attempt = 0; attempt < 5 && !finished; attempt += 1) {
        await waitUntilOnline();
        const result = await completeFileLink(
          this.link.id,
          [...this.etags.entries()].map(([part_number, etag]) => ({ part_number, etag })),
          this.onUnauthorized,
        );
        if (result.success) finished = result.data;
        else if ((result.status ?? 0) === 0 || (result.status ?? 0) >= 500) await sleep(2000 * (attempt + 1));
        else throw serverStop(result);
      }
      if (!finished) throw new StopError('The upload could not be finished. Try again.', true);
      this.link = finished;
      await this.settle(finished);
    } catch (error) {
      if (this.cancelled) return;
      const stop = error instanceof StopError ? error : new StopError('The upload stopped. Try again.', true);
      this.set({ phase: 'failed', error: stop.message, retryable: stop.retryable, sent: this.stored() });
    }
  }

  /** Wait for the server's verdict on a stored file. */
  private async settle(link: ApiFileLink): Promise<void> {
    let current = link;
    let waited = 0;
    while (current.status === 'scanning' && !this.cancelled) {
      this.set({ phase: 'checking', link: current, sent: this.file.size });
      const pause = waited < 30_000 ? 2000 : waited < 600_000 ? 5000 : 10_000;
      await sleep(pause);
      waited += pause;
      const fresh = await getFileLink(current.id, this.onUnauthorized);
      if (fresh.success) current = fresh.data;
    }
    if (this.cancelled) return;
    this.link = current;
    if (current.status === 'ready') {
      this.set({ phase: 'ready', link: current, sent: this.file.size });
    } else if (current.status === 'blocked') {
      this.set({
        phase: 'blocked',
        link: current,
        error: 'A virus was found in this file, so it was removed.',
        retryable: false,
      });
    } else {
      throw new StopError('This file could not be stored. Attach it again.', false);
    }
  }

  private async uploadParts(): Promise<void> {
    const count = this.link!.part_count;
    const queue: number[] = [];
    for (let n = 1; n <= count; n += 1) if (!this.etags.has(n)) queue.push(n);

    // A holder, not a `let`: TypeScript does not see assignments made inside
    // the workers and would treat the check below as always false.
    const failure: { error: StopError | null } = { error: null };
    const worker = async () => {
      while (queue.length > 0 && !failure.error && !this.cancelled) {
        const n = queue.shift()!;
        try {
          await this.uploadPart(n);
        } catch (error) {
          failure.error = error instanceof StopError ? error : new StopError('The upload stopped. Try again.', true);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (failure.error) throw failure.error;
  }

  private async uploadPart(n: number): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      if (this.cancelled) return;
      await waitUntilOnline();
      const url = await this.urlFor(n);
      const outcome = await this.put(n, url);
      if (outcome === null) return;
      if (outcome.kind === 'stop') throw new StopError(outcome.message, false);
      if (outcome.kind === 'resign') this.urls.delete(n);
      if (attempt + 1 >= MAX_PART_ATTEMPTS) {
        throw new StopError('The upload keeps stopping. Check your connection, then try again.', true);
      }
      await sleep(Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500);
    }
  }

  private freshUrl(n: number): string | null {
    const cached = this.urls.get(n);
    return cached && Date.now() - cached.at < URL_MAX_AGE_MS ? cached.url : null;
  }

  /**
   * A signed URL for part n. One request signs it and the next unsigned parts
   * together, and parallel parts wait for that request rather than each
   * sending their own.
   */
  private async urlFor(n: number): Promise<string> {
    for (let round = 0; round < 3; round += 1) {
      const url = this.freshUrl(n);
      if (url) return url;
      if (this.signing) {
        await this.signing.catch(() => undefined);
        continue;
      }
      const count = this.link!.part_count;
      const others: number[] = [];
      for (let p = 1; p <= count && others.length < SIGN_BATCH - 1; p += 1) {
        if (p !== n && !this.etags.has(p) && !this.freshUrl(p)) others.push(p);
      }
      this.signing = this.sign([n, ...others]);
      try {
        await this.signing;
      } finally {
        this.signing = null;
      }
    }
    const url = this.freshUrl(n);
    if (url) return url;
    throw new StopError('The upload could not continue. Try again.', true);
  }

  private signing: Promise<void> | null = null;

  private async sign(parts: number[]): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      const result = await signFileLinkParts(this.link!.id, parts, this.onUnauthorized);
      if (result.success) {
        const at = Date.now();
        for (const [number, url] of Object.entries(result.data.urls)) this.urls.set(Number(number), { url, at });
        return;
      }
      const stop = serverStop(result);
      if (!stop.retryable || attempt >= 4) throw stop;
      await sleep(2000 * (attempt + 1));
      await waitUntilOnline();
    }
  }

  /** One PUT of one part. null = stored. */
  private put(n: number, url: string): Promise<PartFailure | null> {
    const partBytes = this.link!.part_bytes;
    const blob = this.file.slice((n - 1) * partBytes, Math.min(n * partBytes, this.file.size));
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      this.requests.add(xhr);
      let stall: ReturnType<typeof setTimeout> | null = null;
      const finish = (outcome: PartFailure | null) => {
        if (stall) clearTimeout(stall);
        this.requests.delete(xhr);
        this.inFlight.delete(n);
        this.set({ sent: this.stored() });
        resolve(outcome);
      };
      const armStall = () => {
        if (stall) clearTimeout(stall);
        stall = setTimeout(() => xhr.abort(), STALL_MS);
      };

      xhr.open('PUT', url);
      xhr.upload.onprogress = (event) => {
        armStall();
        this.inFlight.set(n, event.loaded);
        this.set({ sent: this.stored() });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader('ETag');
          if (!etag) {
            // Storage answered but its CORS rules hide the ETag header: every
            // part would end the same way, so stop with something to act on.
            finish({ kind: 'stop', message: 'File uploads are not set up on this server yet.' });
            return;
          }
          this.etags.set(n, etag);
          finish(null);
          return;
        }
        // 403: the signature ran out (a long pause, a sleeping laptop).
        finish(xhr.status === 403 ? { kind: 'resign' } : { kind: 'retry' });
      };
      xhr.onerror = () => finish({ kind: 'retry' });
      xhr.onabort = () => finish({ kind: 'retry' });
      xhr.ontimeout = () => finish({ kind: 'retry' });
      armStall();
      xhr.send(blob);
    });
  }
}
