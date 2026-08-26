import { useEffect, useState } from 'react';
import { FolderInput } from 'lucide-react';
import type { WebmailFolder } from '../types';

type MoveEmailModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onMove: (folderName: string) => void;
  /** What is being moved -- one subject, or "3 messages". */
  label: string;
  currentFolder: string;
  folders: WebmailFolder[];
};

/**
 * Folders here are the mailbox's real IMAP folders (Mailbox/get), not a
 * hardcoded list. The old demo version offered a "Create new folder" field
 * that created nothing -- it only set local state and let the user believe a
 * folder existed. Creating folders now lives in the sidebar, where it
 * actually calls the server.
 */
export default function MoveEmailModal({
  isOpen,
  onClose,
  onMove,
  label,
  currentFolder,
  folders,
}: MoveEmailModalProps) {
  const targets = folders.filter((f) => f.name !== currentFolder && f.role !== 'drafts');
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    if (isOpen) setSelected(targets[0]?.name ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentFolder, folders.length]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6 shadow-xl">
        <div className="flex items-center justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-500 flex items-center justify-center">
            <FolderInput size={24} />
          </div>
        </div>

        <h3 className="text-center text-lg font-medium mb-2 text-gray-900 dark:text-gray-100">
          Move to folder
        </h3>
        <p className="text-center text-gray-500 dark:text-gray-400 mb-6 truncate">{label}</p>

        {targets.length === 0 ? (
          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mb-6">
            There is nowhere else to move this — create a folder first.
          </p>
        ) : (
          <div className="mb-6 space-y-1 max-h-60 overflow-y-auto">
            {targets.map((folder) => (
              <label
                key={folder.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
              >
                <input
                  type="radio"
                  name="webmail-move-folder"
                  value={folder.name}
                  checked={selected === folder.name}
                  onChange={() => setSelected(folder.name)}
                />
                <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">
                  {folder.name === 'INBOX' ? 'Inbox' : folder.name}
                </span>
              </label>
            ))}
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
              onMove(selected);
              onClose();
            }}
            disabled={!selected}
            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FolderInput size={16} />
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
