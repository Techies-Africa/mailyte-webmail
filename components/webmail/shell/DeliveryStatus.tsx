'use client';

import { Component, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Ban,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Link2,
  MousePointerClick,
  Send,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Eyebrow } from '@/components/ui/Field';
import { formatShortDateTime } from '@/lib/webmail/dates';
import { useSettings } from '@/lib/webmail/query/accountQueries';
import { deliveryQuery } from '@/lib/webmail/query/mailQueries';
import { useUnauthorizedHandler } from '@/lib/webmail/query/session';
import { spamAdvice, type SpamAdvice } from '@/lib/webmail/spamAdvice';
import type { DeliveryStatus as Status, SpamVerdict, WebmailDelivery } from '../types';

/**
 * What happened to an email you sent: delivered, opened, clicked, and how
 * likely it is to land in spam. Shown above the body of a message in Sent.
 *
 * One recipient reads as a progress rail (Sent, Delivered, Opened, Clicked);
 * several read as an outcome bar with a scrollable list, so a message to a
 * hundred people is still one glance.
 *
 * Everything on it is written for someone who has never heard of SPF or a
 * bounce: plain words, and what to DO about a problem. Anything technical is
 * kept, but only as details for whoever manages the domain (see spamAdvice).
 *
 * It is an extra. Any failure -- a server without the feature, an error, a
 * slow answer, even a rendering mistake in here -- shows nothing and never
 * touches reading or replying to the message.
 */

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'muted';

const WORD: Record<Status, string> = {
  bounced: 'Not delivered',
  rejected: 'Refused',
  complained: 'Marked as spam',
  clicked: 'Clicked a link',
  opened: 'Opened',
  delivered: 'Delivered',
  deferred: 'Delayed',
  pending: 'On its way',
};

const STATUS_TONE: Record<Status, Tone> = {
  delivered: 'success',
  opened: 'success',
  clicked: 'primary',
  deferred: 'warning',
  pending: 'muted',
  bounced: 'danger',
  rejected: 'danger',
  complained: 'danger',
};

/** Worst first, so a problem leads. */
const ORDER: Status[] = ['bounced', 'rejected', 'complained', 'deferred', 'pending', 'clicked', 'opened', 'delivered'];

// Solid fills: the icon takes the card's own colour, so it inverts with the theme
// (dark icon on the bright dark-mode greens, white on the deep light-mode ones).
const SOLID: Record<Tone, string> = {
  primary: 'bg-primary text-primary-foreground',
  success: 'bg-success text-card',
  warning: 'bg-warning text-card',
  danger: 'bg-destructive text-destructive-foreground',
  muted: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
};
const SOFT: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/[0.12] text-success',
  warning: 'bg-warning/[0.14] text-warning',
  danger: 'bg-destructive/[0.12] text-destructive',
  muted: 'bg-muted text-muted-foreground',
};
const TEXT: Record<Tone, string> = {
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  muted: 'text-muted-foreground',
};
const FILL: Record<Tone, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  muted: 'bg-muted-foreground/40',
};
const LINE: Record<Tone, string> = {
  primary: 'bg-primary/50',
  success: 'bg-success/50',
  warning: 'bg-warning/60',
  danger: 'bg-destructive/50',
  muted: 'bg-border',
};

const VERDICT: Record<SpamVerdict, { chip: string; headline: string; tone: Tone; icon: LucideIcon }> = {
  good: { chip: 'Looks fine', headline: 'Most inboxes should accept this email.', tone: 'success', icon: ShieldCheck },
  fair: { chip: 'May go to spam', headline: 'Some inboxes may put this email in the spam folder.', tone: 'warning', icon: ShieldAlert },
  poor: { chip: 'Likely spam', headline: 'Most inboxes will put this email in the spam folder.', tone: 'danger', icon: ShieldAlert },
};

// One short line on a normal screen: why nothing is shown, and what to do next time.
const UNTRACKED_NOTE = 'Tracking was off when you sent this. Turn it on in Settings › Composing for next time.';

function times(count: number): string {
  return count === 1 ? 'once' : `${count} times`;
}

function last(date: Date | null): string | undefined {
  return date ? `last ${formatShortDateTime(date)}` : undefined;
}

/** "Sep 18, 5:02 PM", or nothing when the server gave no time. */
function stamp(date: Date | null): string | undefined {
  return date ? formatShortDateTime(date) : undefined;
}

// --- The progress rail (one recipient) ---------------------------------------

interface Step {
  key: string;
  label: string;
  /** A shorter label for a phone, where a long one would wrap into a third row. */
  short?: string;
  sub?: string;
  /**
   * When it last happened. Shares the row with `sub` ("3 times · Sep 18, 5:02 PM"),
   * so a step is never more than two rows: the label, then one line. Hidden on a
   * phone, where the column is too narrow for it (the hint carries it).
   */
  when?: string;
  tone: Tone;
  /** Shown on hover: why a step is grey. */
  hint?: string;
  /** done: reached. todo: not yet. live: in progress. issue: went wrong or is held up. */
  state: 'done' | 'todo' | 'live' | 'issue';
  icon: LucideIcon;
}

function buildSteps(d: WebmailDelivery, showClicks: boolean): Step[] {
  const status: Status | null = d.recipients[0]?.status ?? null;
  const steps: Step[] = [{ key: 'sent', label: 'Sent', tone: 'primary', state: 'done', icon: Send }];
  let delivered = false;

  if (status === null || status === 'pending') {
    steps.push({ key: 'delivered', label: 'On its way', sub: "We'll update this", tone: 'primary', state: 'live', icon: Clock });
  } else if (status === 'deferred') {
    steps.push({ key: 'delivered', label: 'Delayed', sub: "We'll keep trying", tone: 'warning', state: 'issue', icon: Clock });
  } else if (status === 'bounced') {
    steps.push({ key: 'delivered', label: 'Not delivered', sub: 'Check the address', tone: 'danger', state: 'issue', icon: X });
  } else if (status === 'rejected') {
    steps.push({ key: 'delivered', label: 'Refused', sub: 'Their server said no', tone: 'danger', state: 'issue', icon: Ban });
  } else {
    delivered = true;
    steps.push({ key: 'delivered', label: 'Delivered', tone: 'success', state: 'done', icon: Check });
  }

  // Every expected step is always on the rail; the ones not reached stay grey.
  // Where tracking was off they say so, and what happens next is simply
  // unknown after a failure (nothing can be opened that never arrived).
  const waiting = (tracked: boolean) => (!tracked ? 'Tracking off' : delivered ? 'None recorded' : undefined);
  steps.push(
    d.trackedOpens && d.opens
      ? { key: 'opened', label: 'Opened', sub: times(d.opens.count), when: stamp(d.opens.lastAt), hint: d.opens.lastAt ? `Last opened ${stamp(d.opens.lastAt)}` : undefined, tone: 'success', state: 'done', icon: Eye }
      : {
          key: 'opened',
          label: 'Opened',
          sub: waiting(d.trackedOpens),
          tone: 'muted',
          state: 'todo',
          icon: Eye,
          hint: d.trackedOpens ? undefined : 'Tracking was off when you sent this email, so we cannot tell whether it was opened.',
        },
  );
  // An email with no links in it can never be clicked: no step for it, rather
  // than a grey "Not yet" that suggests something is still to come.
  if (showClicks) {
    steps.push(
      d.trackedClicks && d.clicks
        ? { key: 'clicked', label: 'Clicked a link', short: 'Clicked', sub: times(d.clicks.count), when: stamp(d.clicks.lastAt), hint: d.clicks.lastAt ? `Last clicked ${stamp(d.clicks.lastAt)}` : undefined, tone: 'primary', state: 'done', icon: MousePointerClick }
        : {
            key: 'clicked',
            label: 'Clicked a link',
            short: 'Clicked',
            sub: waiting(d.trackedClicks),
            tone: 'muted',
            state: 'todo',
            icon: MousePointerClick,
            hint: d.trackedClicks ? undefined : 'Link tracking was off when you sent this email, so we cannot tell whether a link was clicked.',
          },
    );
  }
  return steps;
}

function Rail({ steps }: { steps: Step[] }) {
  return (
    // Capped by step count, so a short rail stays a compact group instead of
    // stretching from edge to edge.
    <ol
      className="mx-auto grid"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, maxWidth: steps.length * 170 }}
    >
      {steps.map((s, i) => (
        <li key={s.key} title={s.hint} className="relative flex flex-col items-center px-1 text-center">
          {i > 0 && (
            // From the previous node's centre to this one's, coloured by where this one stands.
            // 14px + half its 2px height = 15px: exactly the centre of the 30px nodes.
            <span aria-hidden className={`absolute right-1/2 top-[14px] h-0.5 w-full rounded-full ${LINE[s.state === 'todo' ? 'muted' : s.tone]}`} />
          )}
          <span
            className={`relative z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full ${SOLID[s.state === 'todo' ? 'muted' : s.tone]} ${
              s.state === 'live' ? 'ring-4 ring-primary/20 motion-safe:animate-pulse' : ''
            }`}
          >
            <s.icon size={15} strokeWidth={2.4} aria-hidden />
          </span>
          <span className={`mt-2 text-[12.5px] font-semibold leading-tight ${s.state === 'todo' ? 'text-muted-foreground' : 'text-foreground'}`}>
            {s.short ? (
              <>
                <span className="sm:hidden">{s.short}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </>
            ) : (
              s.label
            )}
          </span>
          {s.sub && (
            <span className={`mt-0.5 text-[11.5px] leading-snug ${s.state === 'issue' ? TEXT[s.tone] : 'text-muted-foreground'}`}>
              {s.sub}
              {s.when && <span className="hidden sm:inline"> · {s.when}</span>}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// --- The outcome bar (several recipients) -------------------------------------

function Outcomes({ data }: { data: WebmailDelivery }) {
  const counts = new Map<Status, number>();
  for (const r of data.recipients) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const present = ORDER.filter((s) => counts.has(s));
  const cut = data.recipientsTotal > data.recipients.length;

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ${SOLID.primary}`}>
          <Send size={15} strokeWidth={2.4} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold leading-tight text-foreground">Sent to {data.recipientsTotal} people</div>
          <div className="text-[11.5px] leading-snug text-muted-foreground">
            {cut ? `Showing the ${data.recipients.length} that need attention first` : 'How it went for each person'}
          </div>
        </div>
      </div>

      <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={present.map((s) => `${counts.get(s)} ${WORD[s].toLowerCase()}`).join(', ')}>
        {present.map((s) => (
          <span key={s} className={`${FILL[STATUS_TONE[s]]} first:rounded-l-full last:rounded-r-full`} style={{ flexGrow: counts.get(s), flexBasis: 0, minWidth: 6 }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {present.map((s) => (
          <li key={s} className="flex items-center gap-1.5 text-[12.5px]">
            <span aria-hidden className={`h-2 w-2 rounded-full ${FILL[STATUS_TONE[s]]}`} />
            <span className="text-foreground">{WORD[s]}</span>
            <span className="font-semibold tabular-nums text-foreground">{counts.get(s)}</span>
          </li>
        ))}
      </ul>

      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
          <span className="group-open:hidden">Show who got it</span>
          <span className="hidden group-open:inline">Hide the list</span>
        </summary>
        <ul className="mt-2 max-h-52 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/70 bg-background/40">
          {data.recipients.map((r, i) => (
            <li key={`${i}-${r.email}`} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${FILL[STATUS_TONE[r.status]]}`} />
              <span className="min-w-0 flex-1 truncate text-foreground">{r.email}</span>
              <span className="shrink-0 text-muted-foreground">{WORD[r.status]}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Chip({ tone, icon: Icon, children }: { tone: Tone; icon: LucideIcon; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${SOFT[tone]}`}>
      <Icon size={13} strokeWidth={2.2} aria-hidden />
      {children}
    </span>
  );
}

/** Message-level opens and clicks, for a message that went to several people. */
function Engagement({ data, showClicks }: { data: WebmailDelivery; showClicks: boolean }) {
  if (!data.trackedOpens && !(showClicks && data.trackedClicks)) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {data.trackedOpens &&
        (data.opens ? (
          <Chip tone="success" icon={Eye}>
            Opened {times(data.opens.count)}
            {data.opens.lastAt ? <span className="font-normal opacity-80">· {last(data.opens.lastAt)}</span> : null}
          </Chip>
        ) : (
          <Chip tone="muted" icon={Eye}>
            No opens recorded
          </Chip>
        ))}
      {showClicks && data.trackedClicks &&
        (data.clicks ? (
          <Chip tone="primary" icon={MousePointerClick}>
            Clicked a link {times(data.clicks.count)}
            {data.clicks.lastAt ? <span className="font-normal opacity-80">· {last(data.clicks.lastAt)}</span> : null}
          </Chip>
        ) : (
          <Chip tone="muted" icon={MousePointerClick}>
            No clicks recorded
          </Chip>
        ))}
      <span className="text-[11.5px] text-muted-foreground">Counted for the whole email, not for each person.</span>
    </div>
  );
}

// --- Links and spam -----------------------------------------------------------

function Links({ links }: { links: string[] }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[11.5px] font-semibold text-muted-foreground">Links that were clicked</div>
      <ul className="space-y-1">
        {links.map((link) => (
          <li key={link} className="flex items-center gap-1.5 text-[12.5px] text-foreground" title={link}>
            <Link2 size={13} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate">{link.replace(/^https?:\/\//, '')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Three zones (fine, may go to spam, likely spam) with a pin where this email sits. */
function Gauge({ score, verdict }: { score: number; verdict: SpamVerdict }) {
  const pin = Math.max(2, Math.min(98, (score / 10) * 100));
  const zones = { gridTemplateColumns: '30fr 30fr 40fr' };
  return (
    <div>
      <div className="relative">
        <div
          role="meter"
          aria-label="Spam check"
          aria-valuemin={0}
          aria-valuemax={10}
          aria-valuenow={score}
          aria-valuetext={`${score.toFixed(1)} out of 10`}
          className="grid h-2 overflow-hidden rounded-full"
          style={zones}
        >
          <span className="bg-success/30" />
          <span className="bg-warning/35" />
          <span className="bg-destructive/30" />
        </div>
        <span
          aria-hidden
          className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow ${FILL[VERDICT[verdict].tone]}`}
          style={{ left: `${pin}%` }}
        />
      </div>
      <div className="mt-1.5 grid text-[11px] text-muted-foreground" style={zones}>
        <span>Looks fine</span>
        <span>May go to spam</span>
        <span className="text-right">Likely spam</span>
      </div>
    </div>
  );
}

function AdminDetails({ item }: { item: SpamAdvice }) {
  const [copied, setCopied] = useState(false);
  const text = item.reasons.map((r) => `- ${r.plain}${r.fix ? ` ${r.fix}` : ''}`).join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Spam check problems with our email setup:\n${text}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access: the details are still on screen to select.
    }
  };
  return (
    <details className="group/admin mt-1">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDown size={13} className="transition-transform group-open/admin:rotate-180" aria-hidden />
        Details to send your admin
      </summary>
      <div className="mt-1.5 rounded-md border border-border/70 bg-background/40 px-2.5 py-2">
        <ul className="space-y-1.5 text-[12px] text-muted-foreground">
          {item.reasons.map((r, i) => (
            <li key={`${r.rule}-${i}`}>
              {r.plain}
              {r.fix ? <span className="block">{r.fix}</span> : null}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => void copy()}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          {copied ? 'Copied' : 'Copy for your admin'}
        </button>
      </div>
    </details>
  );
}

/** One line: the action, then a few words of hint. */
function AdviceItem({ item }: { item: SpamAdvice }) {
  return (
    <li className="flex gap-2.5 py-1.5">
      <span aria-hidden className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${item.who === 'admin' ? 'bg-primary' : 'bg-muted-foreground/60'}`} />
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        <span className="font-medium text-foreground">{item.title}</span>
        {item.hint && <span className="text-muted-foreground"> · {item.hint}</span>}
        {item.who === 'admin' && <AdminDetails item={item} />}
        {/* A reason we have no short wording for: the server's own words, never dropped. */}
        {item.id === 'other' && (
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12.5px] text-muted-foreground">
            {item.reasons.map((r, i) => (
              <li key={`${r.rule}-${i}`}>{r.fix || r.plain}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const ADVICE_SHOWN = 4;

function Spam({ spam }: { spam: NonNullable<WebmailDelivery['spam']> }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const v = VERDICT[spam.verdict];
  const advice = spamAdvice(spam.reasons);
  const shown = all ? advice : advice.slice(0, ADVICE_SHOWN);

  return (
    <div className="mt-3.5 border-t border-border/70 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="text-[12.5px] text-muted-foreground">Spam check</span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${SOFT[v.tone]}`}>
            <v.icon size={13} strokeWidth={2.2} aria-hidden />
            {v.chip}
          </span>
          <ChevronDown size={15} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3.5">
          <div>
            <p className="mb-2.5 text-[13px] font-medium text-foreground">{v.headline}</p>
            <Gauge score={spam.score} verdict={spam.verdict} />
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">Score {spam.score.toFixed(1)} out of 10. Lower is better.</p>
          </div>

          {advice.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">Nothing to fix.</p>
          ) : (
            <div>
              <p className="mb-2 text-[12px] font-semibold text-foreground">
                {spam.verdict === 'good' ? 'Small things you could improve' : 'How to fix it'}
              </p>
              <ul>
                {shown.map((item) => (
                  <AdviceItem key={item.id} item={item} />
                ))}
              </ul>
              {advice.length > ADVICE_SHOWN && (
                <button
                  type="button"
                  onClick={() => setAll((a) => !a)}
                  className="mt-2 text-[12px] font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {all ? 'Show fewer' : `Show ${advice.length - ADVICE_SHOWN} more`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- The card -------------------------------------------------------------------

function Placeholder() {
  return (
    <div aria-hidden className="mb-4 rounded-xl border border-border bg-card px-4 pb-3.5 pt-3 shadow-sm">
      <div className="mb-3 h-2.5 w-14 animate-pulse rounded bg-muted" />
      <div className="mx-auto flex max-w-[680px]">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-1 flex-col items-center">
            <div className="h-[30px] w-[30px] animate-pulse rounded-full bg-muted" />
            <div className="mt-2 h-3 w-14 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="mt-3.5 border-t border-border/70 pt-3">
        <div className="h-6 w-full animate-pulse rounded bg-muted/70" />
      </div>
    </div>
  );
}

function Body({ messageId, hasLinks }: { messageId: string; hasLinks: boolean }) {
  const onUnauthorized = useUnauthorizedHandler();
  // Only asked of a server that offers the feature, which it announces by
  // sending the tracking switches in the settings. An older server, or one with
  // the feature switched off, gets no request at all -- not one that 404s.
  const offered = useSettings().data?.trackOpens !== undefined;
  const { data, isPending } = useQuery({ ...deliveryQuery(messageId, onUnauthorized), enabled: offered });
  if (!offered) return null;
  // Holds the card's space while it loads, so the message body does not jump
  // down when the answer arrives. A failure collapses it (and shows nothing).
  if (isPending) return <Placeholder />;
  if (!data) return null;

  const several = data.recipientsTotal > 1;
  // Clicks matter only if the email had a link (or one was clicked, which proves it did).
  const showClicks = hasLinks || !!data.clicks;
  const tracked = data.trackedOpens || (showClicks && data.trackedClicks);
  const complained = !several && data.recipients[0]?.status === 'complained';

  return (
    <section aria-label="Delivery" className="mb-4 rounded-xl border border-border bg-card px-4 pb-3.5 pt-3 shadow-sm">
      <Eyebrow className="mb-3">Delivery</Eyebrow>

      {several ? (
        <>
          <Outcomes data={data} />
          <Engagement data={data} showClicks={showClicks} />
        </>
      ) : (
        <Rail steps={buildSteps(data, showClicks)} />
      )}

      {complained && (
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] font-medium text-destructive">
          <TriangleAlert size={14} aria-hidden /> The recipient marked this as spam.
        </p>
      )}

      {data.clicks && data.clicks.links.length > 0 && <Links links={data.clicks.links} />}

      {/* Tells them what to do about it, once, in plain words. */}
      {!tracked && (
        <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
          <EyeOff size={13} className="mt-0.5 shrink-0" aria-hidden /> {UNTRACKED_NOTE}
        </p>
      )}

      {data.spam && <Spam spam={data.spam} />}
    </section>
  );
}

/** A mistake in here must never take the message with it. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function DeliveryStatus({ messageId, hasLinks }: { messageId: string; hasLinks: boolean }) {
  return (
    <Quiet>
      <Body messageId={messageId} hasLinks={hasLinks} />
    </Quiet>
  );
}
