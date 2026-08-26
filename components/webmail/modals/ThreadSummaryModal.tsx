import { useCallback, useEffect, useState } from 'react';
import { X, Hash, RefreshCcw, Copy, Check } from 'lucide-react';
import type { WebmailListItem } from '../types';

type ThreadSummaryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** The real conversation, oldest first. Never a fabricated stand-in. */
  thread: WebmailListItem[];
  onSummarize: () => Promise<string>;
};

export default function ThreadSummaryModal({
  isOpen,
  onClose,
  thread,
  onSummarize,
}: ThreadSummaryModalProps) {
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

  // The previous version called generateSummary() straight from the render
  // body when the modal was open with no summary yet -- a setState during
  // render, which React re-entered on every pass. Kicking it off from an
  // effect keyed on isOpen runs it exactly once per opening.
  useEffect(() => {
    if (isOpen) {
      setSummary('');
      void generateSummary();
    }
  }, [isOpen, generateSummary]);

  if (!isOpen) return null;

  const oldest = thread[0];
  const newest = thread[thread.length - 1];
  const participants = new Set(thread.map((m) => m.fromEmail).filter(Boolean)).size;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium flex items-center">
            <Hash size={18} className="text-violet-500 mr-2" />
            Thread Summary
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {isGenerating ? (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="animate-spin h-8 w-8 border-2 border-violet-500 border-t-transparent rounded-full mb-4" />
              <p className="text-gray-500">Reading the conversation…</p>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-destructive mb-3">{error}</p>
              <button
                onClick={generateSummary}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Try again
              </button>
            </div>
          ) : (
            <div>
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-sm font-medium">AI generated summary</h4>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(summary);
                      setIsCopied(true);
                      setTimeout(() => setIsCopied(false), 2000);
                    }}
                    className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    title="Copy to clipboard"
                  >
                    {isCopied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                  </button>
                  <button
                    onClick={generateSummary}
                    className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    title="Regenerate"
                  >
                    <RefreshCcw size={16} />
                  </button>
                </div>
              </div>

              <div className="bg-violet-50 dark:bg-violet-900/20 p-4 rounded-lg border border-violet-100 dark:border-violet-800/30">
                <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{summary}</p>
              </div>

              {thread.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium mb-3">Conversation</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Messages</span>
                      <span className="font-medium">{thread.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Started</span>
                      <span className="font-medium">{oldest?.timestamp.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Latest</span>
                      <span className="font-medium">{newest?.timestamp.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">People</span>
                      <span className="font-medium">{participants}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
