'use client';

import { useState } from 'react';
import {
  AlertOctagon,
  Archive,
  BookUser,
  CalendarDays,
  CalendarClock,
  ChevronRight,
  File,
  Folder,
  FolderPlus,
  Inbox,
  MoreHorizontal,
  Pencil,
  Send,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import type { WebmailFolder } from '../types';
import { STARRED_VIEW } from '@/lib/webmail/useMailbox';
import SidebarItem, { SidebarDivider, SidebarEyebrow } from './SidebarItem';
import Menu from '@/components/ui/Menu';
import ConfirmModal from '../modals/ConfirmModal';

type FolderNavProps = {
  folders: WebmailFolder[];
  activeFolder: string;
  onFolderChange: (folderName: string) => void;
  collapsed: boolean;
  onCreateFolder?: (name: string) => Promise<string | null>;
  onRenameFolder?: (folder: WebmailFolder, name: string) => Promise<string | null>;
  onDeleteFolder?: (folder: WebmailFolder) => Promise<string | null>;
  /** Absent = this server has no calendar; the row is not rendered. */
  calendar?: { active: boolean; onToggle: () => void };
  contacts?: { active: boolean; onToggle: () => void };
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  inbox: <Inbox />,
  sent: <Send />,
  drafts: <File />,
  scheduled: <CalendarClock />,
  junk: <AlertOctagon />,
  trash: <Trash2 />,
  archive: <Archive />,
};

// Roles first, in the order a mail client conventionally shows them.
const ROLE_ORDER = ['inbox', 'drafts', 'scheduled', 'sent', 'archive', 'junk', 'trash'];

/**
 * Folders the server files mail into on its own (the global Sieve script).
 * IMAP gives them no role, so they are pulled out and drawn as the redesign's
 * coloured dots rather than sorted in among the reader's own folders.
 */
const CATEGORY_DOTS: Record<string, string> = {
  Social: 'hsl(142 60% 50%)',
  Promotions: 'hsl(38 85% 55%)',
  Updates: 'hsl(200 75% 55%)',
  Notifications: 'hsl(280 65% 62%)',
};
const CATEGORY_ORDER = ['Social', 'Promotions', 'Updates', 'Notifications'];

/**
 * Shared mailboxes arrive as IMAP folders under Dovecot's shared namespace:
 * `Shared/<address>/<path>`. They get their own section headed by address so
 * they are never mistaken for the reader's own folders.
 */
const SHARED_PREFIX = 'Shared/';

export interface SharedMailboxGroup {
  address: string;
  folders: { folder: WebmailFolder; label: string }[];
}

export function groupSharedFolders(folders: WebmailFolder[]): SharedMailboxGroup[] {
  const byAddress = new Map<string, { folder: WebmailFolder; label: string }[]>();

  for (const folder of folders) {
    if (!folder.name.startsWith(SHARED_PREFIX)) continue;
    const rest = folder.name.slice(SHARED_PREFIX.length);
    const separator = rest.indexOf('/');
    if (separator === -1) continue;
    const address = rest.slice(0, separator);
    const path = rest.slice(separator + 1);
    if (address === '' || path === '') continue;
    const label = path === 'INBOX' ? 'Inbox' : path;
    const existing = byAddress.get(address) ?? [];
    existing.push({ folder, label });
    byAddress.set(address, existing);
  }

  return [...byAddress.entries()]
    .map(([address, entries]) => ({
      address,
      folders: entries.sort((a, b) => {
        if (a.label === 'Inbox') return -1;
        if (b.label === 'Inbox') return 1;
        return a.label.localeCompare(b.label);
      }),
    }))
    .sort((a, b) => a.address.localeCompare(b.address));
}

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

const SHARED_OPEN_KEY = 'mailyte.webmail.sharedMailboxesOpen';

export default function FolderNav({
  folders,
  activeFolder,
  onFolderChange,
  collapsed,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  calendar,
  contacts,
}: FolderNavProps) {
  const [openShared, setOpenShared] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(SHARED_OPEN_KEY) ?? '{}');
    } catch {
      return {};
    }
  });

  const toggleShared = (address: string) =>
    setOpenShared((previous) => {
      const next = { ...previous, [address]: !previous[address] };
      try {
        localStorage.setItem(SHARED_OPEN_KEY, JSON.stringify(next));
      } catch {
        // Not remembered, still works.
      }
      return next;
    });

  // Creating / renaming happen inline in the rail; deleting asks first.
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WebmailFolder | null>(null);
  const [draftName, setDraftName] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<WebmailFolder | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const submitInline = async () => {
    const name = draftName.trim();
    if (name === '') {
      setCreating(false);
      setEditing(null);
      return;
    }
    setBusy(true);
    const error = editing
      ? await onRenameFolder?.(editing, name)
      : await onCreateFolder?.(name);
    setBusy(false);
    if (error) {
      setInlineError(error);
      return;
    }
    setCreating(false);
    setEditing(null);
    setDraftName('');
    setInlineError(null);
  };

  const cancelInline = () => {
    setCreating(false);
    setEditing(null);
    setDraftName('');
    setInlineError(null);
  };

  const sorted = sortFolders(folders);
  const roleFolders = sorted.filter((f) => f.role !== null);
  const categoryFolders = CATEGORY_ORDER.map((name) =>
    sorted.find((f) => f.role === null && f.name === name),
  ).filter((f): f is WebmailFolder => Boolean(f));
  const categoryNames = new Set(categoryFolders.map((f) => f.name));
  const sharedGroups = groupSharedFolders(sorted);
  const customFolders = sorted.filter(
    (f) => f.role === null && !categoryNames.has(f.name) && !f.name.startsWith(SHARED_PREFIX),
  );

  const inlineEditor = (
    <div className="px-1 py-1">
      <input
        autoFocus
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submitInline();
          if (e.key === 'Escape') cancelInline();
        }}
        onBlur={() => void submitInline()}
        disabled={busy}
        placeholder={editing ? 'New name' : 'Folder name'}
        aria-label={editing ? `Rename ${editing.name}` : 'New folder name'}
        className="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[12.5px] text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
      />
      {inlineError && <p className="mt-1 px-0.5 text-[11px] text-[hsl(0,80%,72%)]">{inlineError}</p>}
    </div>
  );

  const folderMenu = (folder: WebmailFolder) =>
    onRenameFolder || onDeleteFolder ? (
      <Menu
        label={`${folder.name} actions`}
        align="right"
        trigger={({ toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-label={`${folder.name} actions`}
            className="rounded p-0.5 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <MoreHorizontal size={13} />
          </button>
        )}
        items={[
          ...(onRenameFolder
            ? [
                {
                  key: 'rename',
                  label: 'Rename',
                  icon: <Pencil size={13} />,
                  onSelect: () => {
                    setCreating(false);
                    setEditing(folder);
                    // The last path segment is what the server renames.
                    setDraftName(folder.name.split('/').pop() ?? folder.name);
                    setInlineError(null);
                  },
                },
              ]
            : []),
          ...(onDeleteFolder
            ? [
                {
                  key: 'delete',
                  label: 'Delete folder',
                  icon: <Trash2 size={13} />,
                  tone: 'danger' as const,
                  onSelect: () => {
                    setDeleteError(null);
                    setPendingDelete(folder);
                  },
                },
              ]
            : []),
        ]}
      />
    ) : undefined;

  return (
    <>
      {roleFolders.map((f) => (
        <SidebarItem
          key={f.id}
          icon={ROLE_ICONS[f.role ?? ''] ?? <Folder />}
          label={f.name === 'INBOX' ? 'Inbox' : f.name}
          // Nothing in Scheduled is ever unread; what matters there is how
          // many are waiting to go. Junk shows its total, as drawn.
          badge={
            f.role === 'scheduled' ? f.totalEmails : f.role === 'junk' ? f.totalEmails : f.unreadEmails
          }
          badgeTone={f.role === 'inbox' ? 'primary' : 'muted'}
          active={activeFolder === f.name}
          collapsed={collapsed}
          onClick={() => onFolderChange(f.name)}
        />
      ))}
      <SidebarItem
        icon={<Star />}
        label="Starred"
        active={activeFolder === STARRED_VIEW}
        collapsed={collapsed}
        onClick={() => onFolderChange(STARRED_VIEW)}
      />

      {(calendar || contacts) && (
        <>
          <SidebarDivider />
          {calendar && (
            <SidebarItem
              icon={<CalendarDays />}
              label="Calendar"
              active={calendar.active}
              collapsed={collapsed}
              onClick={calendar.onToggle}
            />
          )}
          {contacts && (
            <SidebarItem
              icon={<BookUser />}
              label="Contacts"
              active={contacts.active}
              collapsed={collapsed}
              onClick={contacts.onToggle}
            />
          )}
        </>
      )}

      {categoryFolders.length > 0 && (
        <>
          <SidebarDivider />
          <SidebarEyebrow collapsed={collapsed}>Categories</SidebarEyebrow>
          {categoryFolders.map((f) => (
            <SidebarItem
              key={f.id}
              dot={CATEGORY_DOTS[f.name]}
              label={f.name}
              badge={f.unreadEmails}
              badgeTone="muted"
              active={activeFolder === f.name}
              collapsed={collapsed}
              onClick={() => onFolderChange(f.name)}
            />
          ))}
        </>
      )}

      {sharedGroups.map((group) => {
        const containsActive = group.folders.some((f) => f.folder.name === activeFolder);
        const expanded = openShared[group.address] === true || containsActive;
        const unread = group.folders.reduce((sum, f) => sum + f.folder.unreadEmails, 0);
        return (
          <div key={group.address}>
            <SidebarDivider />
            {collapsed ? (
              <SidebarItem
                icon={<Users />}
                label={group.address}
                badge={unread}
                badgeTone="muted"
                active={containsActive}
                collapsed
                onClick={() => onFolderChange(group.folders[0]?.folder.name ?? activeFolder)}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => toggleShared(group.address)}
                  aria-expanded={expanded}
                  title={group.address}
                  className="flex w-full items-center gap-1.5 px-2.5 pb-1 pt-3 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-white/30 hover:text-white/60"
                >
                  <ChevronRight size={11} className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                  <span className="min-w-0 truncate normal-case tracking-normal text-[11px]">{group.address}</span>
                  {!expanded && unread > 0 && <span className="ml-auto text-[10px]">{unread}</span>}
                </button>
                {expanded &&
                  group.folders.map(({ folder, label }) => (
                    <SidebarItem
                      key={folder.id}
                      icon={label === 'Inbox' ? <Inbox /> : <Folder />}
                      label={label}
                      badge={folder.unreadEmails}
                      badgeTone="muted"
                      active={activeFolder === folder.name}
                      collapsed={false}
                      indent
                      title={folder.name}
                      onClick={() => onFolderChange(folder.name)}
                    />
                  ))}
              </>
            )}
          </div>
        );
      })}

      {(customFolders.length > 0 || onCreateFolder) && (
        <>
          <SidebarDivider />
          {collapsed ? (
            <SidebarEyebrow collapsed>Folders</SidebarEyebrow>
          ) : (
            <div className="flex items-center justify-between pr-1">
              <SidebarEyebrow>Folders</SidebarEyebrow>
              {onCreateFolder && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setCreating((v) => !v);
                    setDraftName('');
                    setInlineError(null);
                  }}
                  title="New folder"
                  aria-label="New folder"
                  className="mt-2 rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
                >
                  <FolderPlus size={13} />
                </button>
              )}
            </div>
          )}

          {creating && !collapsed && inlineEditor}

          {customFolders.map((f) =>
            editing?.id === f.id && !collapsed ? (
              <div key={f.id}>{inlineEditor}</div>
            ) : (
              <SidebarItem
                key={f.id}
                icon={<Folder />}
                label={f.name}
                badge={f.unreadEmails}
                badgeTone="muted"
                active={activeFolder === f.name}
                collapsed={collapsed}
                title={f.name}
                onClick={() => onFolderChange(f.name)}
                trailing={folderMenu(f)}
              />
            ),
          )}
        </>
      )}

      <ConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete || !onDeleteFolder) return;
          const error = await onDeleteFolder(pendingDelete);
          if (error) {
            setDeleteError(error);
            return;
          }
          setPendingDelete(null);
        }}
        keepOpenOnConfirm
        icon={<Trash2 size={18} />}
        tone="danger"
        title="Delete folder"
        body={
          <>
            <span className="font-semibold">{pendingDelete?.name}</span> will be removed.
            {pendingDelete && pendingDelete.totalEmails > 0
              ? ' It still holds mail — the server only deletes an empty folder, so move or delete its messages first.'
              : ' Only an empty folder can be deleted, so nothing is lost.'}
            {deleteError && <span className="mt-2 block text-destructive">{deleteError}</span>}
          </>
        }
        confirmLabel="Delete folder"
        confirmDisabled={pendingDelete ? pendingDelete.totalEmails > 0 : true}
      />
    </>
  );
}
