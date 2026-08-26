import { useEffect, useState } from 'react';

type ConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  icon: React.ReactNode;
  tone?: 'neutral' | 'danger';
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  /**
   * When set, the confirm button stays disabled until the user types this
   * exact word. Reserved for genuinely irreversible actions -- PRD SS7.4
   * allows permanent destruction only from inside Trash, and only behind
   * this.
   */
  typedConfirmation?: string;
};

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  icon,
  tone = 'neutral',
  title,
  body,
  confirmLabel,
  typedConfirmation,
}: ConfirmModalProps) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (isOpen) setTyped('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isDanger = tone === 'danger';
  const canConfirm = !typedConfirmation || typed.trim().toUpperCase() === typedConfirmation.toUpperCase();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6 shadow-xl">
        <div className="flex items-center justify-center mb-4">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center ${
              isDanger
                ? 'bg-red-100 dark:bg-red-900/30 text-red-500'
                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-500'
            }`}
          >
            {icon}
          </div>
        </div>

        <h3 className="text-center text-lg font-medium mb-2 text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        <div className="text-center text-gray-500 dark:text-gray-400 mb-6">{body}</div>

        {typedConfirmation && (
          <div className="mb-6">
            <label
              htmlFor="typed-confirmation"
              className="block text-sm text-gray-600 dark:text-gray-400 mb-1.5"
            >
              Type <span className="font-mono font-semibold">{typedConfirmation}</span> to confirm
            </label>
            <input
              id="typed-confirmation"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
            />
          </div>
        )}

        <div className="flex gap-3 justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={!canConfirm}
            className={`px-4 py-2 rounded-md inline-flex items-center gap-2 text-white disabled:opacity-40 disabled:cursor-not-allowed ${
              isDanger ? 'bg-red-500 hover:bg-red-600' : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {icon}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
