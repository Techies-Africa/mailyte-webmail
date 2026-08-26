import { useState } from 'react';
import { X, Sparkles, Send, Check, RefreshCcw, Copy } from 'lucide-react';

type AiWriterModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onApply: (content: string) => void;
  /** Real Azure OpenAI draft. There is no mock fallback -- see PRD SS2 E1. */
  onGenerate: (prompt: string) => Promise<string>;
};

export default function AiWriterModal({ isOpen, onClose, onApply, onGenerate }: AiWriterModalProps) {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

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

  const handleCopy = () => {
    void navigator.clipboard.writeText(generatedContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium flex items-center">
            <Sparkles size={18} className="text-blue-500 mr-2" />
            AI Email Writer
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <label htmlFor="ai-writer-prompt" className="block text-sm font-medium mb-2">
            What would you like to write about?
          </label>
          <textarea
            id="ai-writer-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. a short reply agreeing to Friday's meeting and asking for the agenda"
            className="w-full h-20 p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent focus:ring-2 focus:ring-primary/20"
            disabled={isGenerating}
          />

          <div className="flex justify-end mt-3">
            <button
              onClick={handleGenerate}
              className="px-4 py-2 bg-primary text-black rounded-md hover:bg-primary/90 flex items-center disabled:opacity-50"
              disabled={isGenerating || !prompt.trim()}
            >
              {isGenerating ? (
                <>
                  <span className="animate-spin h-4 w-4 border-2 border-black border-t-transparent rounded-full mr-2" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles size={16} className="mr-2" />
                  Generate
                </>
              )}
            </button>
          </div>
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}

          {generatedContent && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 mt-6">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-sm font-medium">Generated draft</h4>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    title="Copy"
                    className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  >
                    {isCopied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                  </button>
                  <button
                    onClick={() => {
                      setPrompt('');
                      setGeneratedContent('');
                    }}
                    title="Start over"
                    className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                  >
                    <RefreshCcw size={16} />
                  </button>
                </div>
              </div>

              <div className="whitespace-pre-wrap bg-gray-50 dark:bg-gray-900/50 p-3 rounded-md text-sm">
                {generatedContent}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          {generatedContent && (
            <button
              onClick={() => {
                onApply(generatedContent);
                onClose();
              }}
              className="px-4 py-2 bg-primary text-black rounded-md hover:bg-primary/90 flex items-center"
            >
              <Send size={16} className="mr-2" />
              Use this
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
