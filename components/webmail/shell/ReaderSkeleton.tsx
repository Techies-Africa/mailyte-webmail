import type { WebmailListItem } from '../types';

/**
 * The reading pane while the message you just clicked is still loading.
 *
 * Before this, the pane kept showing the PREVIOUS message until the new one
 * arrived, while the list had already highlighted the new row: for a moment
 * the content on screen was not the message you had opened. This shows what the
 * list already knows about the clicked message (subject and sender) with the
 * rest as quiet placeholder shapes, so the click is acknowledged at once and
 * nothing from the old message lingers.
 */
export default function ReaderSkeleton({ row, isMobile }: { row: WebmailListItem | null; isMobile: boolean }) {
  return (
    <section
      aria-label="Message"
      aria-busy="true"
      className={`flex min-w-0 flex-1 flex-col bg-pane ${isMobile ? 'absolute inset-0 z-20' : ''}`}
    >
      <span className="sr-only" role="status">
        Loading message…
      </span>
      <div className="border-b border-border px-4 py-3.5 sm:px-6">
        {row?.subject ? (
          <h2 className="truncate font-display text-[17px] font-semibold leading-tight text-foreground">{row.subject}</h2>
        ) : (
          <div className="h-5 w-64 max-w-full animate-pulse rounded bg-muted" />
        )}
        <div className="mt-3 flex items-center gap-2.5">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 space-y-1.5">
            {row?.from ? (
              <p className="truncate text-[13.5px] font-semibold leading-tight text-foreground">{row.from}</p>
            ) : (
              <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
            )}
            <div className="h-3 w-44 max-w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto max-w-[760px] space-y-2.5 rounded-xl border border-border bg-card p-5">
          <div className="h-3.5 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </section>
  );
}
