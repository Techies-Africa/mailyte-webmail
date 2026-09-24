import {
  Inbox,
  Send,
  FileEdit,
  CalendarClock,
  Trash2,
  Archive,
  AlertOctagon,
  Star,
  Search,
  Paperclip,
  MailOpen,
} from 'lucide-react';

type WebmailEmptyStateProps = {
  /** The IMAP folder name, or the starred pseudo-view. */
  folder: string;
  role: string | null;
  searchQuery?: string;
  filter?: 'all' | 'unread' | 'starred' | 'attachments';
};

// Per-folder wording rather than one generic "No emails found in this
// folder". An empty Junk folder is good news and should read like it.
const COPY: Record<string, { icon: React.ReactNode; title: string; body: string }> = {
  inbox: {
    icon: <Inbox />,
    title: "You're all caught up",
    body: 'New messages will appear here.',
  },
  sent: { icon: <Send />, title: 'Nothing sent yet', body: 'Messages you send are filed here.' },
  drafts: {
    icon: <FileEdit />,
    title: 'No drafts',
    body: 'Half-written messages are saved here automatically.',
  },
  scheduled: {
    icon: <CalendarClock />,
    title: 'Nothing scheduled',
    body: 'Use the arrow beside Send to write a message now and send it later.',
  },
  trash: {
    icon: <Trash2 />,
    title: 'Trash is empty',
    body: 'Deleted messages stay here until you delete them for good.',
  },
  archive: {
    icon: <Archive />,
    title: 'Nothing archived',
    body: 'Archiving keeps a message without leaving it in the inbox.',
  },
  junk: {
    icon: <AlertOctagon />,
    title: 'Junk is empty — good',
    body: 'Anything you report as spam is filed here.',
  },
};

const FILTER_COPY: Record<string, { icon: React.ReactNode; title: string; body: string }> = {
  unread: { icon: <MailOpen />, title: 'Nothing unread', body: 'Every message here has been read.' },
  starred: { icon: <Star />, title: 'Nothing starred', body: 'Star a message to keep it within easy reach.' },
  attachments: {
    icon: <Paperclip />,
    title: 'No attachments on this page',
    body: 'Try the next page, or search for a file name.',
  },
};

export default function WebmailEmptyState({ folder, role, searchQuery, filter = 'all' }: WebmailEmptyStateProps) {
  let content = role ? COPY[role] : undefined;

  if (searchQuery) {
    content = {
      icon: <Search />,
      title: 'No results',
      body: `Nothing matches “${searchQuery}”. Try a different word, or a sender's address.`,
    };
  } else if (filter !== 'all') {
    content = FILTER_COPY[filter];
  } else if (!content) {
    content =
      folder === '__starred__'
        ? { icon: <Star />, title: 'Nothing starred', body: 'Star a message to keep it within easy reach.' }
        : { icon: <Inbox />, title: 'Nothing here yet', body: 'Messages you move here will show up.' };
  }

  return (
    <div className="flex h-80 flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-[20px] bg-primary/10 text-primary [&>svg]:h-[30px] [&>svg]:w-[30px] [&>svg]:stroke-[1.6]">
        {content.icon}
      </div>
      <h3 className="font-display text-[14.5px] font-bold text-foreground">{content.title}</h3>
      <p className="mt-1.5 max-w-[220px] text-[12.5px] leading-relaxed text-muted-foreground">{content.body}</p>
    </div>
  );
}
