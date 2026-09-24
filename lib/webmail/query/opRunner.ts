import type { QueryClient } from '@tanstack/react-query';
import type { ApiResult } from '@/lib/webmail/client';
import { opsStoreOf, type PendingOp, type RemoveOp } from './pendingOps';
import { accountHeaders, runSessionDropHandlers } from './session';

/**
 * Sending pending actions to the server.
 *
 * One queue per tab, so the server sees actions in the order they were
 * taken: a star can never land after the archive that already changed that
 * message's id. The queue belongs to the query client, not to a screen, so
 * an action taken on the inbox still completes after moving to Calendar.
 *
 * A message id is FOLDER:UID and says nothing about whose mailbox it is in;
 * the server takes that from the session cookie on every request, so
 * INBOX:4521 names a different message -- or nothing -- in the next account.
 * The final guard is the proxy (proxy.ts), which refuses any request named
 * for a mailbox the cookie no longer makes active. Here, the queue also stops
 * itself when it learns the session changed elsewhere, and sends nothing new
 * once a switch or sign-out from this tab is under way.
 */

interface Cursor {
  /** The next id to send. */
  next: number;
  /** Sent, not answered. */
  inFlight: Set<number>;
  stopped: boolean;
}

interface Runner {
  tail: Promise<unknown>;
  generation: number;
  /**
   * Set once held actions have been settled for a switch or sign-out, until
   * the page goes. Nothing new is sent in that window: the cookie is about to
   * belong to someone else.
   */
  closing: boolean;
  /** How to send each action still waiting out its Undo window, by op id. */
  held: Map<number, () => void>;
  /** How far each removal being sent has got, so a closing page can send the rest. */
  cursors: Map<number, Cursor>;
  /** The generation each op was committed in; a closing page sends nothing from an older one. */
  committedIn: Map<number, number>;
}

const runners = new WeakMap<QueryClient, Runner>();

function runnerOf(queryClient: QueryClient): Runner {
  let runner = runners.get(queryClient);
  if (!runner) {
    runner = {
      tail: Promise.resolve(),
      generation: 0,
      closing: false,
      held: new Map(),
      cursors: new Map(),
      committedIn: new Map(),
    };
    runners.set(queryClient, runner);
  }
  return runner;
}

function enqueue(queryClient: QueryClient, task: () => Promise<void>): void {
  const runner = runnerOf(queryClient);
  const next = runner.tail.then(task, task);
  runner.tail = next.catch(() => undefined);
}

/** The queue's generation: work started under an older one has been stopped. */
export function queueGeneration(queryClient: QueryClient): number {
  return runnerOf(queryClient).generation;
}

/** Stop everything queued or part-sent. Actions taken afterwards still run. */
function haltQueue(queryClient: QueryClient): void {
  const runner = runnerOf(queryClient);
  runner.generation += 1;
  for (const cursor of runner.cursors.values()) cursor.stopped = true;
}

export interface OpOutcome {
  ok: string[];
  failed: string[];
  firstError: string | null;
  /** HTTP status of the first failure; 401/403 are the session's business, not a toast's. */
  firstStatus: number | null;
  /** Ids never sent because the session changed first. Nothing to tell the person: the page is going. */
  halted: string[];
}

export type OpRequest = (id: string) => Promise<ApiResult<unknown>>;

/** A message already gone from where it was is, for most removals, done -- but not a cancelled send: then it went. */
function goneCountsAsDone(op: PendingOp): boolean {
  return op.kind === 'remove' && op.reason !== 'cancelScheduled';
}

/**
 * Send `op` now: through the queue, one request per message (the API has no
 * bulk endpoints), at most six at a time so fifty selected rows do not starve
 * the poll and the list. An action undone before its turn comes is skipped.
 */
export function commitOp(
  queryClient: QueryClient,
  opId: number,
  request: OpRequest,
  onOutcome: (op: PendingOp, outcome: OpOutcome) => void,
): void {
  const runner = runnerOf(queryClient);
  const store = opsStoreOf(queryClient);
  const op = store.get(opId);
  if (!op || (op.state !== 'held' && op.state !== 'running')) return;
  // A switch or sign-out is under way: anything sent now reaches the next mailbox.
  if (runner.closing) {
    store.drop(opId);
    return;
  }
  if (op.state === 'held') store.setState(opId, 'running');

  const generation = runner.generation;
  runner.committedIn.set(opId, generation);
  enqueue(queryClient, async () => {
    const current = store.get(opId);
    if (!current) return;
    const cursor: Cursor = { next: 0, inFlight: new Set(), stopped: runner.generation !== generation };
    runner.cursors.set(opId, cursor);

    const results = new Array<ApiResult<unknown> | null>(current.ids.length).fill(null);
    const worker = async () => {
      while (!cursor.stopped && runner.generation === generation && cursor.next < current.ids.length) {
        const index = cursor.next++;
        cursor.inFlight.add(index);
        results[index] = await request(current.ids[index]);
        cursor.inFlight.delete(index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, current.ids.length) }, worker));
    runner.cursors.delete(opId);
    runner.committedIn.delete(opId);
    // Taken over by a closing page, which sent the rest itself.
    if (!store.get(opId)) return;

    const outcome: OpOutcome = { ok: [], failed: [], firstError: null, firstStatus: null, halted: [] };
    results.forEach((result, i) => {
      const id = current.ids[i];
      if (!result) {
        outcome.halted.push(id);
      } else if (result.success || (goneCountsAsDone(current) && result.status === 404)) {
        outcome.ok.push(id);
      } else {
        outcome.failed.push(id);
        if (!outcome.firstError) {
          outcome.firstError = result.message;
          outcome.firstStatus = result.status ?? null;
        }
      }
    });
    onOutcome(current, outcome);
  });
}

// --- Held actions -----------------------------------------------------------------

/** Remember how to send a held action, for when its window closes early. */
export function registerHeld(queryClient: QueryClient, opId: number, commit: () => void): void {
  runnerOf(queryClient).held.set(opId, commit);
}

/** Its window is over: send it. Safe to call twice. */
export function releaseHeld(queryClient: QueryClient, opId: number): void {
  const held = runnerOf(queryClient).held;
  const commit = held.get(opId);
  held.delete(opId);
  commit?.();
}

/** Undone: forget it. Nothing was sent. */
export function discardHeld(queryClient: QueryClient, opId: number): void {
  runnerOf(queryClient).held.delete(opId);
  opsStoreOf(queryClient).drop(opId);
}

/** Send every held action now, in this session. */
export function releaseAllHeld(queryClient: QueryClient): void {
  for (const opId of [...runnerOf(queryClient).held.keys()]) releaseHeld(queryClient, opId);
}

/**
 * This tab is about to hand the session to another mailbox (a switch, a
 * sign-out). Send every held action and give the queue a few seconds to
 * finish while the ids still mean what they meant; after that, nothing new
 * is sent. The queue is not stopped: should the switch fail, it carries on
 * in the same session, and should it succeed, whatever is still going is
 * refused by the proxy rather than reaching the next mailbox.
 */
export async function settleAllHeld(queryClient: QueryClient, timeoutMs = 4000): Promise<void> {
  const runner = runnerOf(queryClient);
  releaseAllHeld(queryClient);
  await Promise.race([runner.tail, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  runner.closing = true;
}

/** The switch or sign-out did not happen after all: this session carries on. */
export function abortSessionChange(queryClient: QueryClient): void {
  runnerOf(queryClient).closing = false;
}

/**
 * The session already belongs to someone else (another tab switched, or the
 * old one expired): nothing still held, queued or part-sent may go, because
 * it would go to the wrong mailbox.
 */
export function dropAllHeld(queryClient: QueryClient): void {
  const runner = runnerOf(queryClient);
  const store = opsStoreOf(queryClient);
  for (const opId of runner.held.keys()) store.drop(opId);
  runner.held.clear();
  haltQueue(queryClient);
  runSessionDropHandlers();
}

/** The request a removal would have made, for a page that is closing before it could. */
function beaconFor(op: RemoveOp, id: string): { url: string; method: string; body?: string } | null {
  const base = `/api/webmail/messages/${encodeURIComponent(id)}`;
  switch (op.reason) {
    case 'trash':
      return { url: `${base}/trash`, method: 'POST', body: '{}' };
    case 'archive':
    case 'move':
    case 'spam':
    case 'notSpam':
      return op.dest ? { url: `${base}/move`, method: 'POST', body: JSON.stringify({ folder: op.dest }) } : null;
    case 'deleteForever':
      return { url: base, method: 'DELETE' };
    case 'discardDraft':
      return { url: `/api/webmail/messages/draft/${encodeURIComponent(id)}`, method: 'DELETE' };
    case 'cancelScheduled':
      return { url: `/api/webmail/messages/scheduled/${encodeURIComponent(id)}`, method: 'DELETE' };
  }
}

/**
 * The page is going away -- a reload, the tab closing -- with removals the
 * person saw happen still unsent: waiting out their Undo window, queued, or
 * part-way through a bulk action. They happen: sent with `keepalive`, which
 * the browser finishes after the page is gone. Unless the session is being
 * handed over, in which case none of it may go.
 */
export function flushHeldOnExit(queryClient: QueryClient): void {
  const runner = runnerOf(queryClient);
  const store = opsStoreOf(queryClient);
  for (const op of store.getSnapshot().ops) {
    if (op.kind !== 'remove' || (op.state !== 'held' && op.state !== 'running')) continue;
    // Committed before the session changed elsewhere: stopped, and not ours to send now.
    const committed = runner.committedIn.get(op.opId);
    const current = committed === undefined || committed === runner.generation;
    if (!runner.closing && current) {
      const cursor = runner.cursors.get(op.opId);
      let unsent: string[] = op.ids;
      if (cursor) {
        cursor.stopped = true;
        // In flight may be cut off by the unload; sending it again is harmless (a 404).
        unsent = [...[...cursor.inFlight].map((i) => op.ids[i]), ...op.ids.slice(cursor.next)];
      }
      for (const id of unsent) {
        const beacon = beaconFor(op, id);
        if (!beacon) continue;
        void fetch(beacon.url, {
          method: beacon.method,
          // Named for this mailbox: if the session has moved on, the proxy refuses it.
          headers: { ...(beacon.body ? { 'Content-Type': 'application/json' } : {}), ...accountHeaders() },
          body: beacon.body,
          keepalive: true,
        }).catch(() => undefined);
      }
    }
    // Should the page come back from the back-forward cache, nothing is sent twice.
    runner.held.delete(op.opId);
    runner.committedIn.delete(op.opId);
    store.settleRemoval(op.opId, op.ids);
  }
}
