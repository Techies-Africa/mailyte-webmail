import { useCallback, useEffect, useRef } from 'react';

/**
 * Unsent compose windows, kept in this browser so that a tab or a browser
 * closed by mistake brings them back (2026-11-06).
 *
 * Not a server save: a page that is going away never sees the answer, so the
 * draft id it would need for the NEXT save is lost, and that save then names a
 * draft the server has already replaced (the server ignores it and keeps both
 * copies). A copy on this device has no such problem, costs the server
 * nothing and is written on every change, so a crash loses nothing either.
 *
 * One key per window, `webmail:compose:<page>:<window>`. A window's snapshot
 * lives as long as the window does -- an autosave must not delete it, or a tab
 * closed a few seconds after one would not bring the window back -- and goes
 * when the window ends with its content safe (sent, discarded, or saved to
 * Drafts and closed). Attachments are not kept: a `File` cannot be stored, and
 * the compose window still asks before a page with some is left.
 *
 * Several tabs: every page holds a Web Lock for as long as it lives. A page
 * only takes over snapshots whose page no longer holds its lock, so reloading
 * one tab never copies another tab's open windows onto the screen.
 */

const PREFIX = 'webmail:compose:';
/** Older than this, a snapshot is thrown away unread: nobody is coming back for it. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WRITE_DELAY_MS = 400;
/**
 * A snapshot longer than this is not kept: one pasted screenshot is several MB
 * of text, which would fill the browser's ~5 MB for the whole site and stall
 * every keystroke's write. The compose window's leave-prompt covers it instead.
 */
const MAX_SNAPSHOT_CHARS = 1_000_000;

/** This page load. A reload is a new one: its predecessor is gone and its windows are up for adoption. */
const TAB = Math.random().toString(36).slice(2) + Date.now().toString(36);
const tabLock = (tab: string) => `webmail-tab:${tab}`;

export type ComposeSnapshot = {
  /** The mailbox it was written in: the server's own answer, never the cached placeholder. */
  account: string;
  savedAt: number;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  /** The draft on the server it supersedes, as of the last confirmed save. */
  draftId?: string;
  /** The shared address it was going from, when not the person's own. */
  from?: string;
  /** The conversation it answers; the quotation is already in `body`. */
  threading?: { inReplyTo?: string; references?: string };
};

function isSnapshot(value: unknown): value is ComposeSnapshot {
  const s = value as Partial<Record<keyof ComposeSnapshot, unknown>> | null;
  return (
    !!s &&
    typeof s === 'object' &&
    typeof s.account === 'string' &&
    typeof s.savedAt === 'number' &&
    (['to', 'cc', 'bcc', 'subject', 'body'] as const).every((field) => typeof s[field] === 'string')
  );
}

let claimed = false;

/**
 * Held until this page is gone: the browser lets go of it when the page is
 * closed, crashed or discarded, which is how another tab learns that the
 * windows written under this id have no owner left.
 */
function claimTab(): void {
  if (claimed || typeof navigator === 'undefined' || !navigator.locks) return;
  claimed = true;
  navigator.locks.request(tabLock(TAB), () => new Promise<void>(() => {})).catch(() => {});
}

function snapshotKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

const keyFor = (windowId: string) => `${PREFIX}${TAB}:${windowId}`;

/** Set by a sign-out: the page is on its way out, and its windows' last-gasp writes must not undo the wipe. */
let wiped = false;

/**
 * False when the text is NOT kept, so the caller must not count on it: storage
 * full or switched off, a sign-out that wiped everything, or a browser without
 * Web Locks (nothing there could ever bring it back).
 */
export function saveSnapshot(windowId: string, snapshot: Omit<ComposeSnapshot, 'savedAt'>): boolean {
  if (wiped || typeof navigator === 'undefined' || !navigator.locks) return false;
  claimTab();
  try {
    const json = JSON.stringify({ ...snapshot, savedAt: Date.now() });
    if (json.length > MAX_SNAPSHOT_CHARS) return false;
    localStorage.setItem(keyFor(windowId), json);
    return true;
  } catch {
    return false;
  }
}

export function forgetSnapshot(windowId: string): void {
  try {
    localStorage.removeItem(keyFor(windowId));
  } catch {
    // Nothing was kept, so nothing to forget.
  }
}

/**
 * On sign-out: whoever uses this browser next must not find the text of unsent
 * mail. When another mailbox stays signed in, only this page's windows (the
 * mailbox being left) go; what other mailboxes or tabs left behind waits for
 * its owner.
 */
export function forgetAllSnapshots(onlyThisTab = false): void {
  wiped = true;
  try {
    for (const key of snapshotKeys()) {
      if (!onlyThisTab || key.startsWith(`${PREFIX}${TAB}:`)) localStorage.removeItem(key);
    }
  } catch {
    // Storage is off; nothing was kept.
  }
}

/**
 * Hands every snapshot of `account` whose page is gone to `open`, oldest first
 * (the newest ends up in front), and removes it once opened. Runs under a lock
 * of its own, so two tabs loading at once cannot both take the same one.
 */
export async function adoptOrphans(account: string, open: (snapshot: ComposeSnapshot) => void): Promise<void> {
  // Without locks a live tab cannot be told from a dead one, and taking a live
  // tab's window would put the same message on screen twice.
  if (typeof navigator === 'undefined' || !navigator.locks) return;
  claimTab();
  try {
    await navigator.locks.request('webmail-compose-adopt', async () => {
      const held = new Set(((await navigator.locks.query()).held ?? []).map((lock) => lock.name));
      const orphans: { key: string; snapshot: ComposeSnapshot }[] = [];
      for (const key of snapshotKeys()) {
        const tab = key.slice(PREFIX.length).split(':')[0];
        // A page that is still alive owns its windows (this one included).
        if (tab === TAB || held.has(tabLock(tab))) continue;
        let snapshot: unknown;
        try {
          snapshot = JSON.parse(localStorage.getItem(key) ?? '');
        } catch {
          snapshot = null;
        }
        if (!isSnapshot(snapshot) || Date.now() - snapshot.savedAt > MAX_AGE_MS) {
          localStorage.removeItem(key);
          continue;
        }
        // Another mailbox's: left for when that one is open here.
        if (snapshot.account === account) orphans.push({ key, snapshot });
      }
      orphans.sort((a, b) => a.snapshot.savedAt - b.snapshot.savedAt);
      for (const { key, snapshot } of orphans) {
        open(snapshot);
        localStorage.removeItem(key);
      }
    });
  } catch {
    // No storage or no locks here: nothing to restore.
  }
}

/**
 * Keeps one compose window's snapshot current: written a moment after each
 * change, and at once when the page is hidden or going away. `build` returns
 * what is worth keeping, or null when nothing is (then an older snapshot of
 * the window goes too: text deleted since must not come back). `changed` lists
 * what a rewrite should follow, including the draft's id once a save has
 * given it a new one.
 *
 * Returns the immediate write, for the guard that decides whether leaving the
 * page needs a question: false means the browser would not keep the text.
 */
export function useSnapshotWriter(
  windowId: string,
  build: () => Omit<ComposeSnapshot, 'savedAt'> | null,
  changed: readonly unknown[],
): () => boolean {
  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  });

  const flush = useCallback((): boolean => {
    const snapshot = buildRef.current();
    if (!snapshot) {
      forgetSnapshot(windowId);
      return true;
    }
    return saveSnapshot(windowId, snapshot);
  }, [windowId]);

  useEffect(() => {
    const timer = window.setTimeout(flush, WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush, ...changed]);

  // `visibilitychange` to hidden is the last event a closing tab reliably
  // sends; `pagehide` is for the browsers that skip it.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush]);

  return flush;
}
