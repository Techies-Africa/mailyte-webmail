'use client';

import { Mail, X } from 'lucide-react';
import type { SendResult, WebmailContact } from '../types';
import type { ComposeWindows } from '@/lib/webmail/useComposeWindows';
import type { ComposePayload, FromOption } from './types';
import type { SendContext } from '@/lib/webmail/useMailbox';
import ComposeWindow, { COMPOSE_GAP, COMPOSE_RIGHT, COMPOSE_WIDTH } from './ComposeWindow';

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

/**
 * Every compose window on screen, plus the row of minimized tabs.
 *
 * Open windows stack from the right edge leftwards; the minimized tabs sit
 * beyond the last open window so nothing overlaps.
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
  const { windows, closeCompose, setLayout, setLabel, setDraftId, reportAttachments } = compose;
  const open = windows.filter((w) => w.layout === 'open');
  const fullscreen = windows.find((w) => w.layout === 'fullscreen');
  const minimized = windows.filter((w) => w.layout === 'minimized');

  // On a phone there is room for exactly one window, full screen.
  const shown = isMobile ? (fullscreen ? [fullscreen] : open.slice(-1)) : [...open, ...(fullscreen ? [fullscreen] : [])];

  return (
    <>
      {shown.map((w) => {
        const stackIndex = w.layout === 'open' ? open.length - 1 - open.indexOf(w) : 0;
        return (
          <ComposeWindow
            key={`${w.id}-${w.seed}`}
            window={w}
            layout={w.layout === 'fullscreen' ? 'fullscreen' : 'open'}
            stackIndex={stackIndex}
            isMobile={isMobile}
            selfAddress={selfAddress}
            selfName={selfName}
            fromOptions={fromOptions}
            contacts={contacts}
            canSchedule={canSchedule}
            onAiWrite={onAiWrite}
            onClose={() => closeCompose(w.id)}
            onMinimize={() => setLayout(w.id, 'minimized')}
            onFullscreen={() => setLayout(w.id, 'fullscreen')}
            onRestore={() => setLayout(w.id, 'open')}
            onLabelChange={(label) => setLabel(w.id, label)}
            onDraftId={(draftId) => setDraftId(w.id, draftId)}
            onAttachmentsChange={(count) => reportAttachments(w.id, count)}
            onSend={(payload) => onSend(payload, { mode: w.mode, replyTo: w.replyTo, draftId: w.draftId })}
            onSaveDraft={onSaveDraft}
            onDiscardDraft={onDiscardDraft}
          />
        );
      })}

      {minimized.length > 0 && (
        <div
          style={
            isMobile
              ? { left: 12, right: 12 }
              : { right: COMPOSE_RIGHT + open.length * (COMPOSE_WIDTH + COMPOSE_GAP) }
          }
          className="fixed bottom-0 z-[140] flex items-end gap-1.5 overflow-x-auto"
        >
          {minimized.map((w) => (
            <div
              key={w.id}
              role="button"
              tabIndex={0}
              onClick={() => setLayout(w.id, 'open')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setLayout(w.id, 'open');
              }}
              title="Restore"
              className="flex min-w-[200px] max-w-[260px] cursor-pointer items-center gap-2 rounded-t-xl bg-sidebar px-3.5 py-2.5 text-white shadow-[0_-2px_12px_rgba(0,0,0,0.18)]"
            >
              <Mail size={12} className="shrink-0 text-white/50" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{w.label}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeCompose(w.id);
                }}
                aria-label={`Close ${w.label}`}
                className="shrink-0 rounded p-0.5 text-white/45 hover:bg-white/10 hover:text-white"
              >
                <X size={11} strokeWidth={2.8} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
