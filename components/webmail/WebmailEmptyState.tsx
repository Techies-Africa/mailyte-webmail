import { Inbox, Send, FileEdit, Trash2, Archive, AlertOctagon, Star, Search } from 'lucide-react';

type WebmailEmptyStateProps = {
  /** The IMAP folder name, or the starred/search pseudo-views. */
  folder: string;
  role: string | null;
  searchQuery?: string;
};

// Per-folder wording rather than one generic "No emails found in this
// folder". An empty Junk folder is good news and should read like it.
const COPY: Record<string, { icon: React.ReactNode; title: string; body: string }> = {
  inbox: {
    icon: <Inbox size={28} />,
    title: 'Your inbox is empty',
    body: 'Nothing new right now. New mail shows up here automatically.',
  },
  sent: {
    icon: <Send size={28} />,
    title: 'Nothing sent yet',
    body: 'Messages you send are filed here.',
  },
  drafts: {
    icon: <FileEdit size={28} />,
    title: 'No drafts',
    body: 'Half-written messages are saved here automatically.',
  },
  trash: {
    icon: <Trash2 size={28} />,
    title: 'Trash is empty',
    body: 'Deleted messages stay here until you empty the trash.',
  },
  archive: {
    icon: <Archive size={28} />,
    title: 'Nothing archived',
    body: 'Archiving keeps a message without leaving it in the inbox.',
  },
  junk: {
    icon: <AlertOctagon size={28} />,
    title: 'Junk is empty — good',
    body: 'Anything you report as spam is filed here.',
  },
};

export default function WebmailEmptyState({ folder, role, searchQuery }: WebmailEmptyStateProps) {
  let content = role ? COPY[role] : undefined;

  if (searchQuery) {
    content = {
      icon: <Search size={28} />,
      title: `No results for “${searchQuery}”`,
      body: 'Try a different word, or search a sender’s address.',
    };
  } else if (!content) {
    content =
      folder === '__starred__'
        ? {
            icon: <Star size={28} />,
            title: 'Nothing starred',
            body: 'Star a message to keep it within easy reach.',
          }
        : {
            icon: <Inbox size={28} />,
            title: `${folder} is empty`,
            body: 'Nothing filed here yet.',
          };
  }

  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400 flex items-center justify-center mb-4">
        {content.icon}
      </div>
      <h3 className="text-base font-medium text-gray-800 dark:text-gray-200">{content.title}</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-sm">{content.body}</p>
    </div>
  );
}
