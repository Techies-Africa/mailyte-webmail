'use client';

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Mail, X } from 'lucide-react';
import type { SendResult, WebmailContact } from '../types';
import type { ComposeWindows } from '@/lib/webmail/useComposeWindows';
import type { ComposePayload, ComposeWindow as ComposeWindowModel, FromOption } from './types';
import type { SendContext } from '@/lib/webmail/useMailbox';
import ComposeWindow from './ComposeWindow';
import IconButton from '@/components/ui/IconButton';
import { PANE_RESIZE_END_EVENT } from '@/lib/webmail/paneLayout';
import {
  COMPOSE_RIGHT,
  COMPOSE_WIDTH,
  DOCK_Z,
  PHONE_EDGE,
  dockViewportNow,
  layoutSlots,
  slotForDrag,
  type DockViewport,
  type Slot,
} from './dockLayout';
import { useDockDrag, type DockDragCallbacks } from './useDockDrag';

type ComposeDockProps = {
  compose: ComposeWindows;
  isMobile: boolean;
  selfAddress: string;
  selfName: string | null;
  fromOptions: FromOption[];
  contacts: WebmailContact[];
  canSchedule: boolean;
  onAiWrite?: (instruction: string, existingBody: string) => Promise<string>;
  onSend: (payload: ComposePayload, context: SendContext) => Promise<SendResult>;
  onSaveDraft: (payload: ComposePayload, replaceId?: string) => Promise<string | null>;
  onDiscardDraft: (id: string) => Promise<void>;
};

// The screen the row is laid out on, re-read when the window or the rail
// changes width. The same object is handed back while nothing has changed:
// useSyncExternalStore compares snapshots by identity, and a fresh object
// every read would render forever.
let viewportSnapshot: DockViewport | null = null;
function readViewport(): DockViewport {
  const next = dockViewportNow();
  if (!viewportSnapshot || viewportSnapshot.width !== next.width || viewportSnapshot.inset !== next.inset) {
    viewportSnapshot = next;
  }
  return viewportSnapshot;
}
function subscribeToViewport(onChange: () => void) {
  const update = () => {
    readViewport();
    onChange();
  };
  // Whatever changed while no dock was mounted (another page, a resize);
  // React reads the snapshot again once subscribed and catches up.
  readViewport();
  window.addEventListener('resize', update);
  window.addEventListener(PANE_RESIZE_END_EVENT, update);
  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener(PANE_RESIZE_END_EVENT, update);
  };
}
const getViewport = () => viewportSnapshot ?? readViewport();
/** The inbox renders its skeleton on the server; the dock only ever draws in the browser. */
const SERVER_VIEWPORT: DockViewport = { width: 0, inset: 0 };
const getServerViewport = () => SERVER_VIEWPORT;

/**
 * Every compose window, docked in ONE ordered row along the bottom edge.
 *
 * The windows array is the row: index 0 is the slot nearest the right edge,
 * and a new window opens at the LEFT end, so the windows already docked never
 * move. A minimized window keeps its slot -- the dock draws its tab there, and
 * the window itself stays mounted and hidden, so its text, attachments,
 * cursor and undo history are all still there when it comes back. When the
 * row runs out of room the least recently used window collapses to a tab in
 * place (useComposeWindows); nothing is ever re-sorted.
 *
 * A window's title bar, or anywhere on a tab, drags it along the row, and
 * Alt+Shift+Arrow moves it one slot, announced to screen readers. Windows are
 * rendered in creation order whatever the row's order, so a reorder only
 * changes `right` -- no DOM node is re-inserted, nothing re-animates, and
 * focus stays where it was. The most recently used draws on top.
 *
 * On a phone there is room for exactly one window, full screen: the one
 * opened or brought forward last. Every other window gets a tab in a strip
 * along the bottom, and nothing drags.
 */
export default function ComposeDock({
  compose,
  isMobile,
  selfAddress,
  selfName,
  fromOptions,
  contacts,
  canSchedule,
  onAiWrite,
  onSend,
  onSaveDraft,
  onDiscardDraft,
}: ComposeDockProps) {
  const { windows, closeCompose, setLayout, setLabel, setDraftId, reportAttachments, activate, moveWindow } = compose;
  const viewport = useSyncExternalStore(subscribeToViewport, getViewport, getServerViewport);
  const slots = layoutSlots(windows, viewport.width, viewport.inset);

  // Least recently used first: a window's place here is its step above DOCK_Z.
  const byRecency = [...windows].sort((a, b) => a.activatedAt - b.activatedAt).map((w) => w.id);
  const topId = byRecency[byRecency.length - 1];
  // Creation order, which never changes: a reorder moves slots, not DOM nodes.
  const rendered = [...windows].sort((a, b) => a.created - b.created);

  // On a phone, the one window on screen.
  const open = windows.filter((w) => w.layout === 'open');
  const fullscreen = windows.find((w) => w.layout === 'fullscreen');
  const frontOnPhone =
    fullscreen ?? open.reduce<ComposeWindowModel | undefined>((a, w) => (!a || w.activatedAt > a.activatedAt ? w : a), undefined);
  const isShown = (w: ComposeWindowModel) => (isMobile ? w.id === frontOnPhone?.id : w.layout !== 'minimized');
  // The phone's strip reads like the desktop row: left end first.
  const phoneTabs = isMobile ? [...windows].reverse().filter((w) => !isShown(w)) : [];
  const canReorder = !isMobile && windows.length > 1;

  // Where focus goes once a minimize or a restore has rendered: Minimize's
  // button is gone, so the tab takes it; a restored window takes it back
  // into its editor, where they were typing.
  const pendingFocusRef = useRef<{ id: string; to: 'tab' | 'editor' } | null>(null);
  const tabRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const want = pendingFocusRef.current;
    if (!want) return;
    pendingFocusRef.current = null;
    if (want.to === 'tab') {
      tabRefs.current.get(want.id)?.focus();
      return;
    }
    // The ProseMirror element itself, NOT TipTap's focus command -- see the
    // Android note in WebmailEditor. ProseMirror puts its own selection back.
    document
      .querySelector<HTMLElement>(`[data-compose-id="${want.id}"] .ProseMirror`)
      ?.focus({ preventScroll: true });
  }, [windows]);

  const minimize = (id: string) => {
    pendingFocusRef.current = { id, to: 'tab' };
    setLayout(id, 'minimized');
  };
  const restoreFromTab = (id: string) => {
    pendingFocusRef.current = { id, to: 'editor' };
    setLayout(id, 'open');
  };

  // Where a drag began, so Escape can put the window back.
  const dragOriginRef = useRef<{ id: string; index: number } | null>(null);
  const dragFor = (w: ComposeWindowModel): DockDragCallbacks => ({
    onStart: () => {
      dragOriginRef.current = { id: w.id, index: windows.indexOf(w) };
    },
    onMove: (right) => {
      // Only on an actual change of slot: a render per pointer move would
      // re-render the whole page for nothing.
      const slot = slots.get(w.id);
      if (!slot) return;
      const to = slotForDrag(windows, slots, w.id, right, slot.width);
      if (to !== windows.indexOf(w)) moveWindow(w.id, to);
    },
    onEnd: (cancelled) => {
      const origin = dragOriginRef.current;
      dragOriginRef.current = null;
      if (cancelled && origin?.id === w.id) moveWindow(w.id, origin.index);
    },
  });

  // What a screen reader hears after a keyboard move.
  const [announcement, setAnnouncement] = useState('');
  const moveBy = (w: ComposeWindowModel, delta: 1 | -1) => {
    const from = windows.indexOf(w);
    const to = Math.max(0, Math.min(windows.length - 1, from + delta));
    const side = delta > 0 ? 'left' : 'right';
    if (to === from) {
      setAnnouncement(`${w.label} is already furthest ${side}`);
      return;
    }
    moveWindow(w.id, to);
    setAnnouncement(`${w.label} moved ${side}: ${windows.length - to} of ${windows.length} from the left`);
  };

  const tabRefFor = (id: string) => (el: HTMLElement | null) => {
    if (el) tabRefs.current.set(id, el);
    else tabRefs.current.delete(id);
  };

  return (
    <>
      {rendered.map((w) => {
        const slot = slots.get(w.id) ?? { right: COMPOSE_RIGHT, width: COMPOSE_WIDTH };
        const zIndex = DOCK_Z + byRecency.indexOf(w.id);
        // Only when it is not on top already: every focus and every press
        // would otherwise re-render the page for nothing.
        const activateThis = () => {
          if (topId !== w.id) activate(w.id);
        };
        const drag = dragFor(w);
        return (
          <Fragment key={w.id}>
            <ComposeWindow
              key={`${w.id}-${w.seed}`}
              window={w}
              layout={w.layout === 'fullscreen' ? 'fullscreen' : 'open'}
              hidden={!isShown(w)}
              right={slot.right}
              width={slot.width}
              zIndex={zIndex}
              canReorder={canReorder && w.layout !== 'fullscreen'}
              onActivate={activateThis}
              drag={drag}
              onMoveBy={(delta) => moveBy(w, delta)}
              isMobile={isMobile}
              selfAddress={selfAddress}
              selfName={selfName}
              fromOptions={fromOptions}
              contacts={contacts}
              canSchedule={canSchedule}
              onAiWrite={onAiWrite}
              onClose={() => closeCompose(w.id)}
              onMinimize={() => minimize(w.id)}
              onFullscreen={() => setLayout(w.id, 'fullscreen')}
              onRestore={() => setLayout(w.id, 'open')}
              onLabelChange={(label) => setLabel(w.id, label)}
              onDraftId={(draftId) => setDraftId(w.id, draftId)}
              onAttachmentsChange={(count) => reportAttachments(w.id, count)}
              onSend={(payload) => onSend(payload, { mode: w.mode, replyTo: w.replyTo, draftId: w.draftId })}
              onSaveDraft={onSaveDraft}
              onDiscardDraft={onDiscardDraft}
            />
            {!isMobile && w.layout === 'minimized' && (
              <DockTab
                label={w.label}
                slot={{ ...slot, zIndex }}
                canReorder={canReorder}
                drag={drag}
                restoreRef={tabRefFor(w.id)}
                onActivate={activateThis}
                onRestore={() => restoreFromTab(w.id)}
                onClose={() => closeCompose(w.id)}
                onMoveBy={(delta) => moveBy(w, delta)}
              />
            )}
          </Fragment>
        );
      })}

      {phoneTabs.length > 0 && (
        <div
          style={{ left: PHONE_EDGE, right: PHONE_EDGE, zIndex: DOCK_Z }}
          className="fixed bottom-0 flex items-end gap-1.5 overflow-x-auto"
        >
          {phoneTabs.map((w) => (
            <DockTab
              key={w.id}
              label={w.label}
              canReorder={false}
              drag={dragFor(w)}
              restoreRef={tabRefFor(w.id)}
              onRestore={() => restoreFromTab(w.id)}
              onClose={() => closeCompose(w.id)}
              onMoveBy={() => {}}
            />
          ))}
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

type DockTabProps = {
  label: string;
  /** Docked in its own slot on a desktop. Absent: one of a phone's strip of tabs, in flow. */
  slot?: Slot & { zIndex: number };
  canReorder: boolean;
  drag: DockDragCallbacks;
  /** The restore region, which takes focus when its window is minimized from the keyboard or a click. */
  restoreRef: (el: HTMLElement | null) => void;
  /** Pressed or focused: raise it above a neighbour it overlaps. Desktop only -- see below. */
  onActivate?: () => void;
  onRestore: () => void;
  onClose: () => void;
  onMoveBy: (delta: 1 | -1) => void;
};

/**
 * A minimized window, as a tab in the window's own slot of the row.
 *
 * The restore region and Close are siblings, never one inside the other: a
 * button nested in a button is two controls a screen reader cannot tell
 * apart, and a click on Close restored the window first. The restore region
 * is a `role="button"` div rather than a <button> so that a press anywhere on
 * the tab but Close can start a drag (useDockDrag ignores presses on real
 * buttons). A drag's drop does not restore it; a click does.
 *
 * `data-shortcuts="off"`: Enter and Space on a focused tab restore it, and
 * must not also open the selected message.
 */
function DockTab({
  label,
  slot,
  canReorder,
  drag: dragCallbacks,
  restoreRef,
  onActivate,
  onRestore,
  onClose,
  onMoveBy,
}: DockTabProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reorderable = canReorder && !!slot;
  const drag = useDockDrag({
    enabled: reorderable,
    rootRef,
    right: slot?.right ?? 0,
    callbacks: dragCallbacks,
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!reorderable || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    // Slots count from the right edge, so ArrowLeft is +1.
    onMoveBy(event.key === 'ArrowLeft' ? 1 : -1);
  };

  return (
    <div
      ref={rootRef}
      data-shortcuts="off"
      role="group"
      aria-label={`${label}, minimized`}
      // On a phone a press must not raise a tab: the window in front is the
      // one used last, and it would swap under the finger before the tap.
      onFocusCapture={onActivate}
      onPointerDownCapture={onActivate}
      onKeyDown={onKeyDown}
      style={slot ? { right: slot.right, width: slot.width, zIndex: slot.zIndex } : undefined}
      className={[
        'flex h-10 select-none items-center gap-1 rounded-t-xl bg-sidebar pr-1.5 text-white shadow-[0_-2px_12px_rgba(0,0,0,0.18)]',
        slot ? 'fixed bottom-0 transition-[right] duration-200 ease-out' : 'min-w-[200px] max-w-[260px] shrink-0',
        reorderable ? 'touch-none' : '',
      ].join(' ')}
      {...drag.handleProps}
    >
      <div
        ref={restoreRef}
        role="button"
        tabIndex={0}
        title="Restore"
        aria-label={`Restore ${label}`}
        onClick={onRestore}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onRestore();
        }}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch rounded-tl-xl pl-3.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
      >
        <Mail size={12} className="shrink-0 text-white/50" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{label}</span>
      </div>
      <IconButton label={`Close ${label}`} tone="onDark" size="xs" onClick={onClose}>
        <X size={11} strokeWidth={2.8} />
      </IconButton>
    </div>
  );
}
