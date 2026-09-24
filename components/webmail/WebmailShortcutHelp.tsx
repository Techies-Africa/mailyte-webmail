import { Keyboard } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import { SHORTCUT_HELP } from '@/lib/webmail/useKeyboardShortcuts';

/** The `?` overlay (PRD S4). Lists exactly the keys that are actually bound. */
export default function WebmailShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Keyboard shortcuts" icon={<Keyboard size={16} />} width="md">
      <ul className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        {SHORTCUT_HELP.map((shortcut) => (
          <li key={shortcut.keys} className="flex items-center justify-between gap-4 text-[13px]">
            <span className="text-muted-foreground">{shortcut.description}</span>
            <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
              {shortcut.keys}
            </kbd>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">Shortcuts are ignored while you are typing.</p>
    </Dialog>
  );
}
