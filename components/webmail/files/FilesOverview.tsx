'use client';

import { useState } from 'react';
import { formatBytes } from '@/components/webmail/compose/attachments';
import type { ApiFile, FileKind, FilesSummary } from '@/lib/webmail/client';
import { formatMonth } from '@/lib/webmail/dates';
import { counterpartOf, formatCount, KIND_LABEL, kindStyle } from './fileMeta';

/**
 * The top of the Files screen: what is in the mailbox at a glance.
 *
 * Numbers first (a KPI row), then three ranked lists -- by type, by sender,
 * the largest files -- each row of which narrows the list below or opens the
 * file. The bars are one hue (the accent) against nothing else: they compare
 * magnitudes, they are not a palette of categories. A picked type or sender
 * stays in the accent and the rest step back to grey.
 *
 * Always the whole mailbox, never the current filter: it is the map the
 * filters are chosen from.
 */
export default function FilesOverview({
  summary,
  activeKind,
  activePerson,
  onPickKind,
  onPickPerson,
  onOpenFile,
}: {
  summary: FilesSummary;
  activeKind: FileKind | null;
  activePerson: string | null;
  onPickKind: (kind: FileKind | null) => void;
  onPickPerson: (email: string | null) => void;
  onOpenFile: (file: ApiFile) => void;
}) {
  const topKind = Math.max(1, ...summary.by_kind.map((k) => k.count));
  const topSender = Math.max(1, ...summary.top_senders.map((s) => s.count));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Files" value={formatCount(summary.total_files)}>
          <MonthColumns months={summary.by_month} />
        </StatTile>
        <StatTile
          label="Space used"
          value={formatBytes(summary.total_bytes)}
          note={summary.largest[0] ? `Largest: ${formatBytes(summary.largest[0].size)}` : undefined}
        />
        <StatTile label="Last 30 days" value={formatCount(summary.last_30_days)} note="new files received or sent" />
        <StatTile
          label="Received · sent"
          value={`${formatCount(summary.received.count)} · ${formatCount(summary.sent.count)}`}
          note={`${formatBytes(summary.received.bytes)} in · ${formatBytes(summary.sent.bytes)} out`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="By type">
          {summary.by_kind.map((row) => (
            <RankRow
              key={row.kind}
              label={KIND_LABEL[row.kind] ?? row.kind}
              value={row.count}
              max={topKind}
              detail={formatBytes(row.bytes)}
              active={activeKind === row.kind}
              dimmed={activeKind !== null && activeKind !== row.kind}
              title={`${formatCount(row.count)} ${KIND_LABEL[row.kind] ?? row.kind} · ${formatBytes(row.bytes)}. Show only these.`}
              onClick={() => onPickKind(activeKind === row.kind ? null : row.kind)}
            />
          ))}
        </Panel>

        <Panel title="Most files from" empty="No files received yet.">
          {summary.top_senders.map((person) => (
            <RankRow
              key={person.email}
              label={person.name?.trim() || person.email}
              value={person.count}
              max={topSender}
              detail={formatBytes(person.bytes)}
              active={activePerson === person.email}
              dimmed={activePerson !== null && activePerson !== person.email}
              title={`${person.email}: ${formatCount(person.count)} files · ${formatBytes(person.bytes)}. Show only these.`}
              onClick={() => onPickPerson(activePerson === person.email ? null : person.email)}
            />
          ))}
        </Panel>

        <Panel title="Largest files" empty="No files yet.">
          {summary.largest.map((file) => {
            const style = kindStyle(file.kind);
            return (
              <button
                key={file.id}
                type="button"
                onClick={() => onOpenFile(file)}
                title={`View ${file.name}`}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-muted/60"
              >
                <span
                  aria-hidden
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5 ${style.tint}`}
                >
                  {style.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-foreground">{file.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{counterpartOf(file)}</span>
                </span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{formatBytes(file.size)}</span>
              </button>
            );
          })}
        </Panel>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border bg-card px-3.5 py-3">
      <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>
      <span className="mt-0.5 truncate font-display text-[22px] font-semibold leading-tight tracking-tight text-foreground">
        {value}
      </span>
      {note && <span className="mt-0.5 truncate text-[11px] text-muted-foreground">{note}</span>}
      {children}
    </div>
  );
}

function Panel({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode[] }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border border-border bg-card px-2 pb-2 pt-2.5">
      <h3 className="px-1.5 pb-1.5 text-[11.5px] font-semibold text-muted-foreground">{title}</h3>
      {children.length > 0 ? (
        <div className="space-y-0.5">{children}</div>
      ) : (
        <p className="px-1.5 py-2 text-[12px] text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

/** One ranked bar: label, a bar from a shared baseline, the value at its tip. */
function RankRow({
  label,
  value,
  max,
  detail,
  active,
  dimmed,
  title,
  onClick,
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
  active: boolean;
  dimmed: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        'grid w-full grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted/60',
      ].join(' ')}
    >
      <span className="truncate text-[12px] text-foreground">{label}</span>
      <span className="flex h-2 items-center">
        {/* Square at the baseline, a 4px rounded end at the value. */}
        <span
          className={`h-2 rounded-r-[4px] ${dimmed ? 'bg-muted-foreground/30' : 'bg-primary'}`}
          style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
        />
      </span>
      <span className="flex items-baseline gap-1.5 text-right">
        <span className="text-[12px] font-semibold tabular-nums text-foreground">{formatCount(value)}</span>
        <span className="hidden text-[10.5px] tabular-nums text-muted-foreground sm:inline">{detail}</span>
      </span>
    </button>
  );
}

/** Mid-month, so no timezone moves "2026-09" into August or October. */
function monthDate(month: string): Date {
  return new Date(`${month}-15T12:00:00Z`);
}

/**
 * Files per month for the last year, as columns: this month in the accent,
 * the eleven before it in grey. Each column answers on hover and on focus;
 * the same numbers sit in a table for screen readers.
 */
function MonthColumns({ months }: { months: FilesSummary['by_month'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(1, ...months.map((m) => m.count));
  const label = (m: { month: string; count: number }) =>
    `${formatMonth(monthDate(m.month))}: ${formatCount(m.count)} file${m.count === 1 ? '' : 's'}`;

  return (
    <div className="relative mt-2">
      <div className="flex h-8 items-end gap-[3px] border-b border-border" onMouseLeave={() => setHover(null)}>
        {months.map((m, i) => (
          <span
            key={m.month}
            tabIndex={0}
            role="img"
            aria-label={label(m)}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            // The hit area is the whole column, not just the painted bar.
            className="flex h-full min-w-0 flex-1 items-end outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {m.count > 0 && (
              <span
                className={[
                  'block w-full max-w-[24px] rounded-t-[3px]',
                  i === months.length - 1 ? 'bg-primary' : 'bg-muted-foreground/35',
                  hover === i ? 'opacity-80' : '',
                ].join(' ')}
                style={{ height: `${Math.max(8, (m.count / top) * 100)}%` }}
              />
            )}
          </span>
        ))}
      </div>
      {hover !== null && (
        <span
          role="status"
          className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-0.5 text-[11px] text-popover-foreground shadow-panel"
          style={{ left: `${((hover + 0.5) / months.length) * 100}%` }}
        >
          <strong className="font-semibold">{formatCount(months[hover].count)}</strong>{' '}
          <span className="text-muted-foreground">{formatMonth(monthDate(months[hover].month))}</span>
        </span>
      )}
      <table className="sr-only">
        <caption>Files per month</caption>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{formatMonth(monthDate(m.month))}</th>
              <td>{m.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
