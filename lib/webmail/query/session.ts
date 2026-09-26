'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Keeping one tab's cached mail from outliving the account it belongs to.
 *
 * Every tab shares the one session cookie, so signing in, switching or
 * signing out in one tab changes whose mailbox the others are talking to.
 * Those tabs still hold the previous account's mail in memory. The tab that
 * made the change announces it here, and every other tab starts over.
 */

const CHANNEL_NAME = 'mailyte-session';

// One instance per tab, used both to post and to listen. A BroadcastChannel
// never hears its own messages, so the tab that announces a change is not
// also sent back to the inbox by it.
let channel: BroadcastChannel | null = null;

function sessionChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

// Handing the session to another mailbox, in this tab. First, anything the
// person already did goes while it still means what they meant: a message in
// its undo-send window is sent (registered by the inbox). Then the action
// queue is settled and stopped (registered by QueryProvider).
const beforeChange = new Set<() => Promise<void>>();
let settler: { settle: () => Promise<void>; abort: () => void } | null = null;

export function addBeforeSessionChange(handler: () => Promise<void>): () => void {
  beforeChange.add(handler);
  return () => {
    beforeChange.delete(handler);
  };
}

export function setSessionSettler(next: { settle: () => Promise<void>; abort: () => void } | null): void {
  settler = next;
}

// Work already set going that has to finish in this session -- a message
// being handed to the server -- before a switch or sign-out may proceed.
const inFlight = new Set<Promise<unknown>>();

export function trackSessionWork<T>(work: Promise<T>): Promise<T> {
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work)).catch(() => undefined);
  return work;
}

/** Called by switchAccount and signOut before they touch the session cookie. */
export async function prepareSessionChange(): Promise<void> {
  await Promise.allSettled([...beforeChange].map((handler) => handler()));
  // A send already under way finishes first, however long its upload takes:
  // cutting it off would lose the message.
  await Promise.allSettled([...inFlight]);
  await settler?.settle();
}

/** The switch failed and the session is unchanged: carry on as before. */
export function abortSessionChange(): void {
  settler?.abort();
}

// The session changed without this tab's say (another tab, an expired
// token): work still waiting in this tab belongs to the old one and must be
// dropped, not sent.
const dropHandlers = new Set<() => void>();

export function addSessionDropHandler(handler: () => void): () => void {
  dropHandlers.add(handler);
  return () => {
    dropHandlers.delete(handler);
  };
}

export function runSessionDropHandlers(): void {
  for (const handler of dropHandlers) handler();
}

/** Tell the other tabs the active mailbox changed. */
export function announceAccountChange(): void {
  sessionChannel()?.postMessage('account-changed');
}

/** Run `handler` when another tab changes the active mailbox. Returns the unsubscribe. */
export function onAccountChange(handler: () => void): () => void {
  const target = sessionChannel();
  if (!target) return () => {};
  const listener = () => handler();
  target.addEventListener('message', listener);
  return () => target.removeEventListener('message', listener);
}

// The address this tab's cache belongs to, from the first capabilities answer.
let knownAccount: string | null = null;

/** The header naming the mailbox a request is for. proxy.ts refuses a mismatch with the cookie. */
export const ACCOUNT_HEADER = 'x-mailbox-account';

/**
 * `init` with this tab's mailbox named on it, once the tab knows which that
 * is. Capabilities is left alone: it is how a tab finds out the account
 * changed under it, so it must always answer.
 */
export function withAccountHeader(input: string, init: RequestInit | undefined): RequestInit | undefined {
  if (!knownAccount || input.startsWith('/api/webmail/capabilities')) return init;
  return {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), [ACCOUNT_HEADER]: knownAccount },
  };
}

/** The same, for a request built by hand (a keepalive beacon). */
export function accountHeaders(): Record<string, string> {
  return knownAccount ? { [ACCOUNT_HEADER]: knownAccount } : {};
}

/**
 * Note whose mailbox the server says this is, and report a change.
 *
 * When the active account's token expires, the proxy quietly falls back to
 * another account signed in on this browser (server.ts). The next request is
 * then someone else's mailbox, while the cache still holds the first one's.
 */
export function accountChanged(email: string): boolean {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  const changed = knownAccount !== null && knownAccount !== address;
  knownAccount = address;
  return changed;
}

// A burst of parallel requests can all come back 401 together. The first
// redirects; the rest have nowhere better to send anyone.
let redirecting = false;

/**
 * A page other than sign-in is now showing, so any redirect that was under way
 * was overtaken (a link clicked, Back pressed). The next 401 must redirect again.
 */
export function clearUnauthorizedRedirect(): void {
  redirecting = false;
}

/** Called by the login page, which is where every session ends and the next begins. */
export function resetSessionState(): void {
  redirecting = false;
  knownAccount = null;
}

/**
 * The one response to an expired or revoked session: stop fetching, go to
 * sign-in. A replace, not a push, so Back does not return to a page that can
 * load nothing.
 */
export function useUnauthorizedHandler(): () => void {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(() => {
    if (redirecting) return;
    // Already there: a late 401 (a draft saved on the way out) must not arm the
    // flag again, or it would stay set with nothing left to clear it.
    if (typeof window !== 'undefined' && window.location.pathname === '/login') return;
    redirecting = true;
    void queryClient.cancelQueries();
    router.replace('/login');
  }, [router, queryClient]);
}
