'use client';

import { useCallback, useRef, useState } from 'react';
import type { ComposeMode, WebmailMessage } from '@/components/webmail/types';
import type { ComposeLayout, ComposeWindow } from '@/components/webmail/compose/types';

/** How many windows may be OPEN (not minimized) at once. Beyond this, the oldest is minimized. */
const MAX_OPEN = 3;

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
}

/**
 * The stack of compose windows: open some, minimize, go fullscreen, close.
 *
 * Only one window can be fullscreen at a time (it covers everything), and at
 * most MAX_OPEN can be windowed -- opening a fourth minimizes the oldest
 * rather than stacking a fourth 560px window off the edge of the screen.
 * Minimizing only hides a window (ComposeDock keeps it mounted), so nothing
 * written in it is lost.
 */
export function useComposeWindows() {
  const [windows, setWindows] = useState<ComposeWindow[]>([]);

  const openCompose = useCallback((options: OpenComposeOptions = {}): string => {
    const id = nextId();
    const mode = options.mode ?? 'compose';
    const layout = options.layout ?? 'open';
    const label = options.resumed?.subject?.trim() || MODE_LABEL[mode];

    setWindows((current) => {
      // Resuming a draft that is already open just brings it forward.
      if (options.draftId) {
        const existing = current.find((w) => w.draftId === options.draftId);
        if (existing) {
          return current.map((w) =>
            w.id === existing.id ? { ...w, layout: 'open', activatedAt: nextActivation() } : w,
          );
        }
      }

      let next = current.map((w) =>
        // A new fullscreen window demotes any other fullscreen one.
        layout === 'fullscreen' && w.layout === 'fullscreen' ? { ...w, layout: 'open' as const } : w,
      );

      const open = next.filter((w) => w.layout === 'open');
      if (layout === 'open' && open.length >= MAX_OPEN) {
        const oldest = open[0];
        next = next.map((w) => (w.id === oldest.id ? { ...w, layout: 'minimized' as const } : w));
      }

      return [
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
          layout,
          label,
          seed: 0,
          activatedAt: nextActivation(),
        },
      ];
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

  const setLayout = useCallback((id: string, layout: ComposeLayout) => {
    setWindows((current) => {
      let next = current.map((w) =>
        layout === 'fullscreen' && w.id !== id && w.layout === 'fullscreen'
          ? { ...w, layout: 'open' as const }
          : w,
      );
      if (layout === 'open') {
        const open = next.filter((w) => w.layout === 'open' && w.id !== id);
        if (open.length >= MAX_OPEN) {
          const oldest = open[0];
          next = next.map((w) =>
            w.id === oldest.id ? { ...w, layout: 'minimized' as const } : w,
          );
        }
      }
      return next.map((w) =>
        w.id === id ? { ...w, layout, activatedAt: layout === 'minimized' ? w.activatedAt : nextActivation() } : w,
      );
    });
  }, []);

  // Both return the SAME array when nothing changed. A fresh array from map()
  // is a state change to React even when every element is identical, and the
  // window's label effect fires after every render -- so "no change" has to
  // be literally no change, or the two chase each other forever.
  const setLabel = useCallback((id: string, label: string) => {
    setWindows((current) => {
      const target = current.find((w) => w.id === id);
      if (!target || target.label === label) return current;
      return current.map((w) => (w.id === id ? { ...w, label } : w));
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

  return { windows, openCompose, closeCompose, setLayout, setLabel, setDraftId, reportAttachments, hasAttachments };
}

export type ComposeWindows = ReturnType<typeof useComposeWindows>;
