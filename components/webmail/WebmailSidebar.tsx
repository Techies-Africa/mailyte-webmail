import { useState } from 'react';
import {
  Inbox,
  Star,
  Send,
  File,
  Trash2,
  Archive,
  AlertOctagon,
  Folder,
  Plus,
  FolderPlus,
} from 'lucide-react';
import type { WebmailFolder } from './types';

type WebmailSidebarProps = {
  /** Real IMAP folders. `starred` below is a virtual view, not one of these. */
  folders: WebmailFolder[];
  activeFolder: string;
  onFolderChange: (folderName: string) => void;
  onCompose: () => void;
  /**
   * Create a real IMAP folder (PRD S5). Returns an error message, or null on
   * success. Omitted = no "New folder" control, because the demo's version
   * of this opened a modal that created nothing.
   */
  onCreateFolder?: (name: string) => Promise<string | null>;
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  inbox: <Inbox size={18} />,
  sent: <Send size={18} />,
  drafts: <File size={18} />,
  junk: <AlertOctagon size={18} />,
  trash: <Trash2 size={18} />,
  archive: <Archive size={18} />,
};

// Roles first, in the order a mail client conventionally shows them, then
// custom folders alphabetically. The mail server hands folders back in IMAP
// LIST order, which is arbitrary.
const ROLE_ORDER = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash'];

function sortFolders(folders: WebmailFolder[]): WebmailFolder[] {
  return [...folders].sort((a, b) => {
    const ai = a.role ? ROLE_ORDER.indexOf(a.role) : -1;
    const bi = b.role ? ROLE_ORDER.indexOf(b.role) : -1;
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.name.localeCompare(b.name);
  });
}

export const STARRED_VIEW = '__starred__';

export default function WebmailSidebar({
  folders,
  activeFolder,
  onFolderChange,
  onCompose,
  onCreateFolder,
}: WebmailSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitNewFolder = async () => {
    const name = newName.trim();
    if (name === '' || !onCreateFolder) return;

    setBusy(true);
    const error = await onCreateFolder(name);
    setBusy(false);

    if (error) {
      setCreateError(error);
      return;
    }
    setCreating(false);
    setNewName('');
    setCreateError(null);
  };

  const sorted = sortFolders(folders);
  const roleFolders = sorted.filter((f) => f.role !== null);
  const customFolders = sorted.filter((f) => f.role === null);

  const row = (
    key: string,
    icon: React.ReactNode,
    label: string,
    badge: number,
    isActive: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      onClick={onClick}
      className={`flex items-center justify-between w-full px-3 py-2 text-sm rounded-r-full ${
        isActive
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {badge > 0 && <span className="text-xs font-medium flex-shrink-0">{badge}</span>}
    </button>
  );

  return (
    <div className="w-56 md:w-56 sm:w-full border-r border-gray-200 dark:border-gray-700 h-full overflow-y-auto bg-gray-50 dark:bg-gray-800 flex flex-col">
      <div className="p-4">
        <button
          onClick={onCompose}
          className="w-full bg-primary text-black rounded-lg p-3 font-medium flex items-center justify-center gap-2"
        >
          <Plus size={18} />
          <span>Compose</span>
        </button>
      </div>

      <div className="mt-2">
        {roleFolders.map((f) =>
          row(
            f.id,
            ROLE_ICONS[f.role ?? ''] ?? <Folder size={18} />,
            f.name === 'INBOX' ? 'Inbox' : f.name,
            f.unreadEmails,
            activeFolder === f.name,
            () => onFolderChange(f.name),
          ),
        )}

        {/* Starred is not an IMAP folder -- it's a keyword ($flagged) query
            across the mailbox, so it sits with the folders but resolves to a
            search, not a SELECT. */}
        {row(
          STARRED_VIEW,
          <Star size={18} />,
          'Starred',
          0,
          activeFolder === STARRED_VIEW,
          () => onFolderChange(STARRED_VIEW),
        )}
      </div>

      {(customFolders.length > 0 || onCreateFolder) && (
        <div className="mt-4">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Folders
            </span>
            {onCreateFolder && (
              <button
                onClick={() => {
                  setCreating((open) => !open);
                  setCreateError(null);
                }}
                className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
                title="New folder"
                aria-label="New folder"
              >
                <FolderPlus size={15} />
              </button>
            )}
          </div>

          {creating && (
            <div className="px-3 pb-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitNewFolder();
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setCreateError(null);
                  }
                }}
                onBlur={() => void submitNewFolder()}
                disabled={busy}
                placeholder="Folder name"
                className="w-full text-sm px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              {createError && <p className="mt-1 text-xs text-red-600">{createError}</p>}
            </div>
          )}

          {customFolders.map((f) =>
            row(
              f.id,
              <Folder size={18} />,
              f.name,
              f.unreadEmails,
              activeFolder === f.name,
              () => onFolderChange(f.name),
            ),
          )}
        </div>
      )}
    </div>
  );
}
