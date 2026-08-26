import { X } from 'lucide-react';
import { SHORTCUT_HELP } from '@/lib/webmail/useKeyboardShortcuts';

/** The `?` overlay (PRD S4). Lists exactly the keys that are actually bound. */
export default function WebmailShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-medium text-gray-900 dark:text-gray-100">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <ul className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {SHORTCUT_HELP.map((shortcut) => (
            <li key={shortcut.keys} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-gray-600 dark:text-gray-400">{shortcut.description}</span>
              <kbd className="px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-xs font-mono text-gray-700 dark:text-gray-300">
                {shortcut.keys}
              </kbd>
            </li>
          ))}
        </ul>

        <p className="px-5 pb-4 text-xs text-gray-500">
          Shortcuts are ignored while you are typing.
        </p>
      </div>
    </div>
  );
}
