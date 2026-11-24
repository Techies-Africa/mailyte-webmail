import type { Metadata } from 'next';
import { Clock, Download, FileText, Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import AuthLayout from '@/components/auth/AuthLayout';
import { apiBaseUrl } from '@/lib/webmail/server';

/**
 * A file shared from a mailbox as a download link (mail.mailyte.com/f/<token>).
 *
 * Open to anyone with the link, as any shared link is; the person opening it
 * usually has no mailbox here at all. Opening the page downloads nothing:
 * Download is a form POST, so the link scanners in Outlook and Gmail, which
 * open every URL in an email, never count as a download or pull the file.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared file',
  robots: { index: false, follow: false },
  // The token is the whole credential: never hand it on in a Referer.
  referrer: 'no-referrer',
};

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

type State =
  | 'available'
  | 'pending'
  | 'expired'
  | 'removed'
  | 'removed_by_operator'
  | 'blocked'
  | 'not_found'
  | 'unavailable';

interface SharedFile {
  state: State;
  name?: string;
  size?: number;
  shared_by?: { name: string | null; email: string };
  expires_at?: string | null;
  scan?: string;
  abuse_email?: string | null;
}

async function load(token: string): Promise<SharedFile> {
  if (!TOKEN.test(token)) return { state: 'not_found' };
  try {
    const res = await fetch(`${apiBaseUrl()}/file-links/public/${token}`, { cache: 'no-store' });
    const body = await res.json().catch(() => null);
    const data = body?.data as SharedFile | undefined;
    if (data?.state) return data;
    return { state: res.status === 404 ? 'not_found' : 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    date,
  );
}

const PROBLEMS: Record<string, string> = {
  busy: 'This file has been downloaded a lot today. Try again tomorrow.',
  error: "The download couldn't start. Try again in a moment.",
  gone: 'This file is no longer available.',
};

const CLOSED: Partial<Record<State, { title: string; text: (who: string) => string }>> = {
  pending: {
    title: 'Almost ready',
    text: () => 'This file is still being prepared. Try again in a few minutes.',
  },
  expired: {
    title: 'This link has expired',
    text: (who) => `Ask ${who} to send the file again.`,
  },
  removed: {
    title: 'This file is no longer shared',
    text: (who) => `${who} stopped sharing it. Ask them to send it again if you still need it.`,
  },
  removed_by_operator: {
    title: 'This file was removed',
    text: () => 'It was taken down because it broke the rules for sharing files.',
  },
  blocked: {
    title: 'This file was removed',
    text: () => 'A virus was found in it, so it was deleted before anyone could download it.',
  },
  not_found: {
    title: "This link doesn't work",
    text: () => 'Check that the whole link was copied, or ask the sender to send it again.',
  },
  unavailable: {
    title: 'Something went wrong',
    text: () => "We couldn't load this file just now. Try again in a moment.",
  },
};

const cues = [
  { icon: Lock, label: 'Downloads over an encrypted connection' },
  { icon: ShieldCheck, label: 'Files up to 100 MB are checked for viruses' },
  { icon: Clock, label: 'Links stop working when they expire' },
];

const headline = (
  <>
    Big files,
    <br />
    sent with
    <br />
    <span className="text-brand-gradient">one link.</span>
  </>
);

export default async function SharedFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const problem = typeof query.problem === 'string' ? PROBLEMS[query.problem] : undefined;
  const file = await load(token);

  const sharer = file.shared_by?.name || file.shared_by?.email || 'the sender';
  const until = formatDate(file.expires_at);
  const panel = 'Shared from a Mailyte mailbox. The file downloads straight from secure storage.';

  if (file.state !== 'available') {
    const closed = CLOSED[file.state] ?? CLOSED.not_found!;
    return (
      <AuthLayout
        title={closed.title}
        description={closed.text(sharer)}
        panelHeadline={headline}
        panelDescription={panel}
        trustCues={cues}
      >
        <p className="text-sm text-muted-foreground">
          {file.state === 'pending' ? 'Refresh this page in a few minutes.' : 'Nothing will download from this link.'}
        </p>
      </AuthLayout>
    );
  }

  const unscanned = file.scan === 'too_big' || file.scan === 'unscanned';

  return (
    <AuthLayout
      title="A file was shared with you"
      description={
        <>
          <span data-clarity-mask="True">{sharer}</span> sent you a file{until ? `. It's available until ${until}.` : '.'}
        </>
      }
      panelHeadline={headline}
      panelDescription={panel}
      trustCues={cues}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <FileText size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-all text-[15px] font-semibold text-foreground" data-clarity-mask="True">
            {file.name}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {typeof file.size === 'number' ? formatBytes(file.size) : ''}
            {file.shared_by?.email ? (
              <>
                {' · from '}
                <span data-clarity-mask="True">{file.shared_by.email}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {problem && (
        <p className="mt-5 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{problem}</p>
      )}

      <form method="post" action={`/f/${token}/download`} className="mt-6">
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Download size={16} /> Download
        </button>
      </form>

      <p className="mt-4 flex items-start gap-2 text-[12.5px] text-muted-foreground">
        {unscanned ? (
          <>
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              {file.scan === 'too_big'
                ? 'This file is too big to be checked for viruses.'
                : "This file couldn't be checked for viruses."}{' '}
              Only open it if you trust the sender.
            </span>
          </>
        ) : (
          <>
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            <span>Checked for viruses before it was shared.</span>
          </>
        )}
      </p>

      {file.abuse_email && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Something wrong with this file?{' '}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href={`mailto:${file.abuse_email}?subject=${encodeURIComponent(`Report a shared file: ${token}`)}`}
          >
            Report it
          </a>
          .
        </p>
      )}
    </AuthLayout>
  );
}
