import type { QueryClient } from '@tanstack/react-query';
import type { ApiResult } from '@/lib/webmail/client';
import { opsStoreOf, type PendingOp, type RemoveOp } from './pendingOps';

/**
 * Sending pending actions to the server.
 *
 * One queue per tab, so the server sees actions in the order they were
 * taken: a star can never land after the archive that already changed that
 * message's id. The queue belongs to the query client, not to a screen, so
 * an action taken on the inbox still completes after moving to Calendar.
 */

const queues = new WeakMap<QueryClient, Promise<unknown>>();

function enqueue(queryClient: QueryClient, task: () => Promise<void>): Promise<void> {
  const tail = queues.get(queryClient) ?? Promise.resolve();
  const next = tail.then(task, task);
  queues.set(queryClient, next.catch(() => undefined));
  return next;
}

/** At most `limit` requests at once: fifty selected rows must not starve the poll and the list. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface OpOutcome {
  ok: string[];
  failed: string[];
  firstError: string | null;
  /** HTTP status of the first failure; 401/403 are the session's business, not a toast's. */
  firstStatus: number | null;
}

export type OpRequest = (id: string) => Promise<ApiResult<unknown>>;

/**
 * Send `op` now: through the queue, one request per message (the API has no
 * bulk endpoints). An action undone before its turn comes is skipped.
 */
export function commitOp(
  queryClient: QueryClient,
  opId: number,
  request: OpRequest,
  onOutcome: (op: PendingOp, outcome: OpOutcome) => void,
): void {
  const store = opsStoreOf(queryClient);
  const op = store.get(opId);
  if (!op || (op.state !== 'held' && op.state !== 'running')) return;
  if (op.state === 'held') store.setState(opId, 'running');

  void enqueue(queryClient, async () => {
    const current = store.get(opId);
    if (!current) return;
    const results = await mapLimit(current.ids, 6, request);
    const outcome: OpOutcome = { ok: [], failed: [], firstError: null, firstStatus: null };
    results.forEach((result, i) => {
      const id = current.ids[i];
      // A message already gone from where it was is, for a removal, done.
      const done = result.success || (current.kind === 'remove' && result.status === 404);
      if (done) {
        outcome.ok.push(id);
      } else {
        outcome.failed.push(id);
        if (!outcome.firstError && !result.success) {
          outcome.firstError = result.message;
          outcome.firstStatus = result.status ?? null;
        }
      }
    });
    onOutcome(current, outcome);
  });
}

// --- Held actions -----------------------------------------------------------------

// How to send each action still waiting out its Undo window, by op id. Kept
// here rather than on the op, so the store stays plain data.
const heldCommits = new WeakMap<QueryClient, Map<number, () => void>>();

function heldOf(queryClient: QueryClient): Map<number, () => void> {
  let held = heldCommits.get(queryClient);
  if (!held) {
    held = new Map();
    heldCommits.set(queryClient, held);
  }
  return held;
}

/** Remember how to send a held action, for when its window closes early. */
export function registerHeld(queryClient: QueryClient, opId: number, commit: () => void): void {
  heldOf(queryClient).set(opId, commit);
}

/** Its window is over: send it. Safe to call twice. */
export function releaseHeld(queryClient: QueryClient, opId: number): void {
  const held = heldOf(queryClient);
  const commit = held.get(opId);
  held.delete(opId);
  commit?.();
}

/** Undone: forget it. Nothing was sent. */
export function discardHeld(queryClient: QueryClient, opId: number): void {
  heldOf(queryClient).delete(opId);
  opsStoreOf(queryClient).drop(opId);
}

/**
 * Send every held action now and wait for the queue to empty -- before the
 * session changes hands. Afterwards the same ids would name messages in a
 * different mailbox.
 */
export async function settleAllHeld(queryClient: QueryClient, timeoutMs = 4000): Promise<void> {
  for (const opId of [...heldOf(queryClient).keys()]) releaseHeld(queryClient, opId);
  const tail = queues.get(queryClient);
  if (!tail) return;
  await Promise.race([tail, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

/**
 * The session already belongs to someone else (another tab switched, or the
 * old one expired): anything still held must never be sent, because it would
 * be sent to the wrong mailbox.
 */
export function dropAllHeld(queryClient: QueryClient): void {
  const store = opsStoreOf(queryClient);
  for (const opId of heldOf(queryClient).keys()) store.drop(opId);
  heldOf(queryClient).clear();
}

/** The request a held removal would have made, for a page that is closing before it could. */
function beaconFor(op: RemoveOp, id: string): { url: string; body: string } | null {
  const base = `/api/webmail/messages/${encodeURIComponent(id)}`;
  if (op.reason === 'trash') return { url: `${base}/trash`, body: '{}' };
  if (op.dest && (op.reason === 'archive' || op.reason === 'move' || op.reason === 'spam' || op.reason === 'notSpam')) {
    return { url: `${base}/move`, body: JSON.stringify({ folder: op.dest }) };
  }
  return null;
}

/**
 * The page is going away -- a reload, a sign-out, the tab closing -- while
 * some removals are still waiting out their Undo window. The person saw them
 * happen, so they happen: sent with `keepalive`, which the browser finishes
 * after the page is gone.
 */
export function flushHeldOnExit(queryClient: QueryClient): void {
  const store = opsStoreOf(queryClient);
  for (const op of store.getSnapshot().ops) {
    if (op.state !== 'held' || op.kind !== 'remove') continue;
    for (const id of op.ids) {
      const beacon = beaconFor(op, id);
      if (!beacon) continue;
      void fetch(beacon.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: beacon.body,
        keepalive: true,
      }).catch(() => undefined);
    }
    // Should the page come back from the back-forward cache, it must not send them twice.
    heldOf(queryClient).delete(op.opId);
    store.tombstone(op.ids);
    store.drop(op.opId);
  }
}
