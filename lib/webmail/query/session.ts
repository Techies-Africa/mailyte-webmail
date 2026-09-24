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
    redirecting = true;
    void queryClient.cancelQueries();
    router.replace('/login');
  }, [router, queryClient]);
}
