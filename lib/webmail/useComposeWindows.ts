'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComposeMode, WebmailMessage } from '@/components/webmail/types';
import type { ComposeLayout, ComposeWindow } from '@/components/webmail/compose/types';
import { dockViewportNow, fitToViewport } from '@/components/webmail/compose/dockLayout';
import { PANE_RESIZE_END_EVENT } from '@/lib/webmail/paneLayout';

const MODE_LABEL: Record<ComposeMode, string> = {
  compose: 'New message',
  reply: 'Reply',
  replyAll: 'Reply all',
  forward: 'Forward',
};

let counter = 0;
function nextId(): string {
  counter += 1;
  return `c${Date.now().toString(36)}${counter}`;
}

// A running count, not a clock: two clicks in one millisecond must still
// differ. Taken OUTSIDE the state updaters, as nextId is -- StrictMode calls
// an updater twice, and each call would otherwise take a different number.
let activations = 0;
const nextActivation = () => ++activations;

export interface OpenComposeOptions {
  mode?: ComposeMode;
  replyTo?: WebmailMessage;
  initialBody?: string;
  draftId?: string;
  resumed?: { to: string; cc: string; bcc: string; subject: string };
  layout?: ComposeLayout;
  /** Files to start with: a message coming back from Undo or a failed send. */
  attachments?: File[];
  /** The address it was being sent from, when not the person's own. */
  from?: string;
  /** initialBody already carries the quotation; do not add it again. */
  quoteIncluded?: boolean;
  /** Put back from somewhere, not typed yet: closing it should still save it. */
  restored?: boolean;
  /** The thread a resumed reply draft belongs to, carried when there is no replyTo. */
  threading?: { inReplyTo?: string; references?: string };
}

/**
 * The compose windows: open some, minimize, go full screen, reorder, close.
 *
 * The array is ONE ordered row -- the dock's slots, index 0 nearest the right
 * edge. A new window is appended, so it opens at the LEFT end and every
 * window already docked stays exactly where it is. Minimizing, restoring and
 * full screen change a window's shape and never its index; only moveWindow
 * (a drag, or Alt+Shift+Arrow) changes the order.
 *
 * Only one window can be full screen at a time (it covers everything). When
 * the row does not fit -- more than MAX_OPEN whole windows, or wider than the
 * screen beside the rail -- the least recently used open window collapses to
 * a tab IN PLACE (dockLayout's fitToViewport), on opening, on restoring, and
 * again whenever the screen or the rail changes width. Growing the screen
 * back re-expands nothing: what someone minimized stays where they can see it.
 *
 * Minimizing only hides a window (ComposeDock keeps it mounted), so nothing
 * written in it is lost.
 */
export function useComposeWindows() {
  const [windows, setWindows] = useState<ComposeWindow[]>([]);

  // Re-fit when the screen narrows or the rail is dragged wider. Once a frame
  // at most: a window drag-resize fires dozens of these a second. A listener
  // callback, not the effect body, sets the state.
  useEffect(() => {
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const { width, inset } = dockViewportNow();
        setWindows((current) => fitToViewport(current, width, inset));
      });
    };
    window.addEventListener('resize', refit);
    window.addEventListener(PANE_RESIZE_END_EVENT, refit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', refit);
      window.removeEventListener(PANE_RESIZE_END_EVENT, refit);
    };
  }, []);

  const openCompose = useCallback((options: OpenComposeOptions = {}): string => {
    const id = nextId();
    const stamp = nextActivation();
    const { width, inset } = dockViewportNow();
    const mode = options.mode ?? 'compose';
    const layout = options.layout ?? 'open';
    const label = options.resumed?.subject?.trim() || MODE_LABEL[mode];

    setWindows((current) => {
      // Resuming a draft that is already open just brings it forward, in its own slot.
      if (options.draftId) {
        const existing = current.find((w) => w.draftId === options.draftId);
        if (existing) {
          const next = current.map((w) =>
            w.id === existing.id
              ? { ...w, layout: w.layout === 'fullscreen' ? ('fullscreen' as const) : ('open' as const), activatedAt: stamp }
              : w,
          );
          return fitToViewport(next, width, inset, existing.id);
        }
      }

      const next = current.map((w) =>
        // A new fullscreen window demotes any other fullscreen one.
        layout === 'fullscreen' && w.layout === 'fullscreen' ? { ...w, layout: 'open' as const } : w,
      );

      // Appended: the slot at the LEFT end. No window already docked changes
      // its place in the row -- the one being written in stays where it is.
      return fitToViewport(
        [
          ...next,
          {
            id,
            mode,
            replyTo: options.replyTo,
            initialBody: options.initialBody,
            draftId: options.draftId,
            resumed: options.resumed,
            attachments: options.attachments,
            from: options.from,
            quoteIncluded: options.quoteIncluded,
            restored: options.restored,
            threading: options.threading,
            layout,
            label,
            to: options.resumed?.to ?? '',
            seed: 0,
            activatedAt: stamp,
            created: stamp,
          },
        ],
        width,
        inset,
        id,
      );
    });

    return id;
  }, []);

  // How many attachments each window holds. A draft keeps the text but not
  // the files, so leaving the inbox with any attached is worth a question.
  const attachmentsRef = useRef(new Map<string, number>());
  const reportAttachments = useCallback((id: string, count: number) => {
    if (count > 0) attachmentsRef.current.set(id, count);
    else attachmentsRef.current.delete(id);
  }, []);
  const hasAttachments = useCallback(() => attachmentsRef.current.size > 0, []);

  const closeCompose = useCallback((id: string) => {
    attachmentsRef.current.delete(id);
    setWindows((current) => current.filter((w) => w.id !== id));
  }, []);

  /**
   * Changes a window's shape, never its slot. Restoring or going full screen
   * counts as using it, and the row is re-fitted around it: something else
   * may collapse in place to make room, never the window just brought back.
   */
  const setLayout = useCallback((id: string, layout: ComposeLayout) => {
    const stamp = nextActivation();
    const { width, inset } = dockViewportNow();
    setWindows((current) => {
      const next = current.map((w) => {
        if (w.id === id) return { ...w, layout, activatedAt: layout === 'minimized' ? w.activatedAt : stamp };
        // One full screen at a time; the one it replaces goes back to its own slot.
        if (layout === 'fullscreen' && w.layout === 'fullscreen') return { ...w, layout: 'open' as const };
        return w;
      });
      return layout === 'minimized' ? next : fitToViewport(next, width, inset, id);
    });
  }, []);

  // All five below return the SAME array when nothing changed. A fresh array
  // from map() is a state change to React even when every element is
  // identical, and the window's label effect fires after every render -- so
  // "no change" has to be literally no change, or the two chase each other
  // forever. For activate and moveWindow it also spares the whole page a
  // render on every focus and every pointer move of a drag.
  const setLabel = useCallback((id: string, label: string) => {
    setWindows((current) => {
      const target = current.find((w) => w.id === id);
      if (!target || target.label === label) return current;
      return current.map((w) => (w.id === id ? { ...w, label } : w));
    });
  }, []);

  /** The To line, for the minimized tab. Same-array guarded, like the label it sits beside. */
  const setTo = useCallback((id: string, to: string) => {
    setWindows((current) => {
      const target = current.find((w) => w.id === id);
      if (!target || target.to === to) return current;
      return current.map((w) => (w.id === id ? { ...w, to } : w));
    });
  }, []);

  /** Note a draft id the window has been saved under, so closing keeps track. */
  const setDraftId = useCallback((id: string, draftId: string) => {
    setWindows((current) => {
      const target = current.find((w) => w.id === id);
      if (!target || target.draftId === draftId) return current;
      return current.map((w) => (w.id === id ? { ...w, draftId } : w));
    });
  }, []);

  /**
   * Brings a window to the top of the stack without moving it -- focusing or
   * pressing anywhere in it. Also what the collapse order reads as "in use".
   */
  const activate = useCallback((id: string) => {
    const stamp = nextActivation();
    setWindows((current) => {
      const target = current.find((w) => w.id === id);
      if (!target || current.every((w) => w.activatedAt <= target.activatedAt)) return current;
      return current.map((w) => (w.id === id ? { ...w, activatedAt: stamp } : w));
    });
  }, []);

  /** Moves a window to slot `toIndex` (0 = nearest the right edge); the others close up in order. */
  const moveWindow = useCallback((id: string, toIndex: number) => {
    setWindows((current) => {
      const from = current.findIndex((w) => w.id === id);
      const to = Math.max(0, Math.min(current.length - 1, toIndex));
      if (from === -1 || from === to) return current;
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  return {
    windows,
    openCompose,
    closeCompose,
    setLayout,
    setLabel,
    setTo,
    setDraftId,
    activate,
    moveWindow,
    reportAttachments,
    hasAttachments,
  };
}

export type ComposeWindows = ReturnType<typeof useComposeWindows>;
