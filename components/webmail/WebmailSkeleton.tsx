/**
 * What the mailbox looks like before it has anything to show.
 *
 * This was a centred line of text on an empty screen, which had two problems.
 * It gave no sense of progress -- an empty page reads the same whether the app
 * is working or hung -- and the entire interface then appeared at once,
 * shifting everything the moment data arrived.
 *
 * A skeleton of the real layout fixes both: the frame is already in place, so
 * nothing jumps when the mailbox paints, and the shapes tell the reader what
 * is coming. Dimensions here are copied from the live components (header
 * py-2/px-4 with a lg:w-56 brand block, sidebar w-56, list rows px-4 py-3) --
 * if those change, these should follow, or the layout will shift again.
 *
 * Deliberately not a spinner. A spinner says "wait"; this says what for.
 */
export default function WebmailSkeleton() {
  return (
    <div
      className="h-screen flex flex-col bg-white dark:bg-gray-900"
      role="status"
      aria-busy="true"
      aria-label="Loading your mailbox"
    >
      {/* Screen readers get the sentence; sighted readers get the shapes. */}
      <span className="sr-only">Loading your mailbox…</span>

      {/* Header — mirrors WebmailHeader */}
      <div className="border-b border-gray-200 dark:border-gray-700 py-2 px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 lg:w-56 shrink-0">
            <Block className="h-7 w-7 rounded" />
            <Block className="h-4 w-20 rounded hidden sm:block" />
          </div>
          <div className="flex-1 min-w-0 flex justify-center">
            <Block className="hidden sm:block h-9 w-full max-w-2xl rounded-full" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Block className="h-8 w-8 rounded-full" />
            <Block className="h-8 w-8 rounded-full" />
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar — mirrors WebmailSidebar's w-56 */}
        <div className="w-56 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shrink-0 hidden md:flex flex-col">
          <div className="p-4">
            <Block className="h-12 w-full rounded-lg" />
          </div>
          <div className="mt-2 px-3 flex flex-col gap-1">
            {/* Six system folders, at the widths real folder names sit at. */}
            {[64, 56, 44, 60, 46, 48].map((w, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Block className="h-[18px] w-[18px] rounded shrink-0" />
                <Block className="h-3 rounded" style={{ width: w }} />
              </div>
            ))}
          </div>
        </div>

        {/* Message list — mirrors WebmailList rows */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center gap-3">
            <Block className="h-4 w-4 rounded" />
            <Block className="h-4 w-4 rounded" />
          </div>

          {/* Staggered so the eye reads it as loading rather than as content.
              Rows fade down the list, which also stops eight identical bars
              looking like a rendering fault. */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800"
              // Rows fade down the list so it reads as loading rather than as
              // content, and so eight identical bars don't look like a fault.
              style={{ opacity: 1 - i * 0.09 }}
            >
              {/* Same widths as WebmailList's own loading rows (w-4, w-4,
                  w-44, flex-1, w-12) so this hands over to that skeleton
                  without a visible change when the session resolves. */}
              <Block className="h-4 w-4 rounded shrink-0" />
              <Block className="h-4 w-4 rounded shrink-0" />
              <Block className="h-3.5 w-44 rounded shrink-0" />
              <Block className="h-3.5 rounded flex-1" />
              <Block className="h-3.5 w-12 rounded shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One shimmering placeholder.
 *
 * `animate-pulse` is Tailwind's own, so this needs no keyframes of its own and
 * respects prefers-reduced-motion through Tailwind's motion-safe handling.
 */
function Block({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`bg-gray-200 dark:bg-gray-700 animate-pulse ${className}`}
    />
  );
}
