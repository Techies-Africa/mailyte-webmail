/**
 * What the mailbox looks like before it has anything to show.
 *
 * A skeleton of the real layout: the dark rail, the list column and the
 * reading pane are already in place, so nothing jumps when the mailbox
 * paints, and the shapes say what is coming. Deliberately not a spinner.
 *
 * The rail and list take their widths from the same CSS variables as the real
 * panes (pane-rail, pane-list in globals.css), which the <head> script has set
 * before this first paint -- a remembered width or a collapsed rail is drawn
 * right from the start. On a phone the list is the full width.
 */
export default function WebmailSkeleton() {
  return (
    <div className="flex h-dvh overflow-hidden bg-pane" role="status" aria-busy="true" aria-label="Loading your mailbox">
      <span className="sr-only">Loading your mailbox…</span>

      <div className="pane-rail hidden h-full shrink-0 flex-col overflow-hidden bg-sidebar px-2.5 pb-3.5 md:flex">
        <div className="flex items-center justify-between px-0.5 pb-2.5 pt-3.5">
          <Block dark className="rail-open-only h-6 w-24 rounded" />
          <Block dark className="h-[30px] w-[30px] rounded-md" />
        </div>
        <Block dark className="mb-3 h-10 w-full rounded-xl" />
        <div className="space-y-1">
          {[72, 58, 46, 62, 50, 52, 60].map((w, i) => (
            <div key={i} className="flex items-center gap-2 px-2.5 py-[7px]">
              <Block dark className="h-[14px] w-[14px] rounded" />
              <Block dark className="rail-open-only h-3 rounded" style={{ width: w }} />
            </div>
          ))}
        </div>
        <div className="mt-auto">
          <Block dark className="h-11 w-full rounded-[9px]" />
        </div>
      </div>

      <div className="pane-list flex h-full shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-3.5 pb-2.5 pt-3">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* The phone's Menu button. */}
              <Block className="h-7 w-7 rounded-md md:hidden" />
              <Block className="h-4 w-16 rounded" />
            </div>
            <div className="flex gap-1">
              <Block className="h-7 w-7 rounded-md" />
              <Block className="h-7 w-7 rounded-md" />
              <Block className="h-7 w-7 rounded-md" />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Block className="h-6 w-12 rounded-md" />
            <Block className="h-6 w-10 rounded-full" />
            <Block className="h-6 w-14 rounded-full" />
            <Block className="h-6 w-14 rounded-full" />
          </div>
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-start gap-2 border-b border-border/70 px-3 py-2.5" style={{ opacity: 1 - i * 0.08 }}>
            <Block className="mt-0.5 h-[13px] w-[13px] rounded" />
            <Block className="h-[26px] w-[26px] rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Block className="h-3 w-2/5 rounded" />
              <Block className="h-3 w-4/5 rounded" />
              <Block className="h-2.5 w-3/5 rounded" />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden flex-1 md:block" />
    </div>
  );
}

function Block({ className = '', style, dark = false }: { className?: string; style?: React.CSSProperties; dark?: boolean }) {
  return <div style={style} className={`animate-pulse ${dark ? 'bg-white/10' : 'bg-muted'} ${className}`} />;
}
