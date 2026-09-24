'use client';

import { useState } from 'react';
import { Sparkles, Check, RefreshCcw, Copy, Send } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import { Label, Textarea } from '@/components/ui/Field';

type AiWriterModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onApply: (content: string) => void;
  /** A real draft from the server's AI endpoint. There is no mock fallback. */
  onGenerate: (prompt: string) => Promise<string>;
};

export default function AiWriterModal({ isOpen, onClose, onApply, onGenerate }: AiWriterModalProps) {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    try {
      setGeneratedContent(await onGenerate(prompt));
    } catch {
      setError('Could not generate a draft. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Write with AI"
      icon={<Sparkles size={16} />}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {generatedContent && (
            <Button
              variant="primary"
              icon={<Send size={13} />}
              onClick={() => {
                onApply(generatedContent);
                onClose();
              }}
            >
              Use this
            </Button>
          )}
        </>
      }
    >
      <Label htmlFor="ai-writer-prompt">What should the message say?</Label>
      <Textarea
        id="ai-writer-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. a short reply agreeing to Friday's meeting and asking for the agenda"
        className="h-24 resize-none"
        disabled={isGenerating}
      />
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          busy={isGenerating}
          disabled={!prompt.trim()}
          icon={<Sparkles size={13} />}
          onClick={() => void handleGenerate()}
        >
          {isGenerating ? 'Generating…' : 'Generate'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {generatedContent && (
        <div className="mt-5 rounded-xl border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h4 className="text-[12.5px] font-semibold">Generated draft</h4>
            <div className="flex gap-1">
              <IconButton
                label="Copy"
                size="xs"
                onClick={() => {
                  void navigator.clipboard.writeText(generatedContent);
                  setIsCopied(true);
                  setTimeout(() => setIsCopied(false), 2000);
                }}
              >
                {isCopied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
              </IconButton>
              <IconButton
                label="Start over"
                size="xs"
                onClick={() => {
                  setPrompt('');
                  setGeneratedContent('');
                }}
              >
                <RefreshCcw size={13} />
              </IconButton>
            </div>
          </div>
          <div className="whitespace-pre-wrap px-3 py-3 text-sm leading-relaxed">{generatedContent}</div>
        </div>
      )}
    </Dialog>
  );
}
