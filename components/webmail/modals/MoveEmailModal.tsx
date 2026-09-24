'use client';

import { useEffect, useState } from 'react';
import { Folder, FolderInput, Inbox } from 'lucide-react';
import type { WebmailFolder } from '../types';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';

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
 * Folders here are the mailbox's real IMAP folders, not a hardcoded list.
 * Creating one lives in the sidebar, where it actually calls the server.
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
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(targets[0]?.name ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentFolder, folders.length]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Move to folder"
      icon={<FolderInput size={16} />}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!selected}
            icon={<FolderInput size={13} />}
            onClick={() => {
              onMove(selected);
              onClose();
            }}
          >
            Move
          </Button>
        </>
      }
    >
      <p className="mb-3 truncate text-sm text-muted-foreground">{label}</p>

      {targets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          There is nowhere else to move this — create a folder first.
        </p>
      ) : (
        <div className="thin-scroll max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
          {targets.map((folder) => {
            const isOn = selected === folder.name;
            return (
              <label
                key={folder.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${
                  isOn ? 'bg-selection text-primary' : 'hover:bg-muted'
                }`}
              >
                <input
                  type="radio"
                  name="webmail-move-folder"
                  value={folder.name}
                  checked={isOn}
                  onChange={() => setSelected(folder.name)}
                  className="accent-primary"
                />
                {folder.role === 'inbox' ? (
                  <Inbox size={14} className="text-muted-foreground" />
                ) : (
                  <Folder size={14} className="text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {folder.name === 'INBOX' ? 'Inbox' : folder.name}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
