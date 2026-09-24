'use client';

import { useCallback, useEffect, useState } from 'react';
import { Hash, RefreshCcw, Copy, Check } from 'lucide-react';
import type { WebmailListItem } from '../types';
import { formatDateTime } from '@/lib/webmail/dates';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';

type ThreadSummaryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** The real conversation, oldest first. Never a fabricated stand-in. */
  thread: WebmailListItem[];
  onSummarize: () => Promise<string>;
};

export default function ThreadSummaryModal({ isOpen, onClose, thread, onSummarize }: ThreadSummaryModalProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [summary, setSummary] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSummary = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    try {
      setSummary(await onSummarize());
    } catch {
      setError('Could not summarize this conversation. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }, [onSummarize]);

  // Kicked off from an effect keyed on isOpen so it runs exactly once per
  // opening, never during render.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSummary('');
      void generateSummary();
    }
  }, [isOpen, generateSummary]);

  const oldest = thread[0];
  const newest = thread[thread.length - 1];
  const participants = new Set(thread.map((m) => m.fromEmail).filter(Boolean)).size;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Conversation summary"
      icon={<Hash size={16} />}
      width="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {isGenerating ? (
        <div className="flex flex-col items-center justify-center py-10">
          <div className="mb-3 h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Reading the conversation…</p>
        </div>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="mb-3 text-sm text-destructive">{error}</p>
          <Button onClick={() => void generateSummary()}>Try again</Button>
        </div>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[12.5px] font-semibold">AI-generated summary</h4>
            <div className="flex gap-1">
              <IconButton
                label="Copy to clipboard"
                size="xs"
                onClick={() => {
                  void navigator.clipboard.writeText(summary);
                  setIsCopied(true);
                  setTimeout(() => setIsCopied(false), 2000);
                }}
              >
                {isCopied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
              </IconButton>
              <IconButton label="Regenerate" size="xs" onClick={() => void generateSummary()}>
                <RefreshCcw size={13} />
              </IconButton>
            </div>
          </div>

          <div className="whitespace-pre-wrap rounded-xl border border-primary/20 bg-primary/[0.05] px-4 py-3 text-sm leading-relaxed">
            {summary}
          </div>

          {thread.length > 0 && (
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">
              <dt className="text-muted-foreground">Messages</dt>
              <dd className="text-right font-semibold tabular-nums">{thread.length}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd className="text-right font-semibold">{oldest ? formatDateTime(oldest.timestamp) : '—'}</dd>
              <dt className="text-muted-foreground">Latest</dt>
              <dd className="text-right font-semibold">{newest ? formatDateTime(newest.timestamp) : '—'}</dd>
              <dt className="text-muted-foreground">People</dt>
              <dd className="text-right font-semibold tabular-nums">{participants}</dd>
            </dl>
          )}
        </div>
      )}
    </Dialog>
  );
}
