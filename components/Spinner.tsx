/**
 * The one spinner.
 *
 * Waiting used to be spelled out by hand wherever it happened, and it showed:
 * "Loading…", "Loading settings…", "Loading vacation settings…", in three
 * different greys (text-neutral-500, text-gray-500, text-gray-400), none of
 * them the muted-foreground token -- plus a violet ring in the summary modal
 * that outlived the accent it was picked to match. Eleven places to edit to
 * change one thing, and no two of them the same.
 *
 * This is that one thing. The shape is not new: it is the ring the mailbox
 * already showed while a message opened, two arcs turning on the accent, with
 * the size lifted to a prop. The colour is `border-primary`, so the accent
 * themes in globals.css reach it without an edit here -- which is why a
 * hardcoded violet or a literal hex is the wrong answer.
 *
 * Deliberately NOT for buttons. A button carries its own label and disabled
 * state, and its ring has to be `border-current` to stay legible whatever the
 * button is painted; those spinners stay where they are.
 *
 * Deliberately NOT a replacement for WebmailSkeleton either. A spinner says
 * "wait"; the skeleton says what for. The mailbox's first paint is worth the
 * second answer.
 *
 * Lives at the root of components/ rather than under webmail/ because it has
 * no domain: webmail/ and calendar/ are siblings here, and the calendar and
 * address-book pages need this too.
 */

type SpinnerProps = {
  /**
   * 'sm' (16px) sits in a line of text, 'md' (32px) suits a panel, 'lg' (40px)
   * a whole page. These are the three sizes already in use, not a new scale.
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * The accessible name -- always announced, never shown unless `showLabel`
   * says so. Most waits are obvious from where the ring is, and a page that
   * prints "Loading…" under a spinner has said it twice.
   */
  label?: string;
  /** Show `label` as text, for a wait long enough to need words. */
  showLabel?: boolean;
  /**
   * Fill and centre in the parent rather than sitting in the text flow.
   * `flex-1` is inert outside a flex container, so a region with no height of
   * its own must bring one (className="py-12", className="min-h-screen").
   */
  fullArea?: boolean;
  /** One-off spacing or height. Lands on the outer element. */
  className?: string;
};

// Border stays 2px at every size: the arcs read as a line, not a donut, and a
// thickness that scaled would be a second decision to keep in sync.
const RING: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

export default function Spinner({
  size = 'md',
  label = 'Loading',
  showLabel = false,
  fullArea = false,
  className = '',
}: SpinnerProps) {
  // Inline is a row, so the ring sits where the sentence it replaced sat.
  // Full-area is a column, so a label lands under the ring rather than beside
  // it. No min-height here: callers pass their own, and two min-height classes
  // on one element is a fight decided by stylesheet order, not by the author.
  const layout = fullArea
    ? 'flex-1 flex flex-col items-center justify-center gap-3'
    : 'inline-flex items-center gap-2';

  return (
    <div
      className={`${layout} ${className}`.trim()}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      {/* Only the top and bottom borders get a width -- left and right stay at
          zero, which is what leaves two arcs turning rather than a closed
          ring. shrink-0 keeps it round inside a tight flex row.

          motion-reduce:animate-none because Tailwind's animate-spin has no
          reduced-motion guard of its own, and this component turned ten static
          sentences into ten perpetual animations. The ring still reads as a
          pending state when stopped; the accessible name carries the rest. */}
      <div
        className={`${RING[size]} shrink-0 animate-spin motion-reduce:animate-none rounded-full border-t-2 border-b-2 border-primary`}
      />
      {/* One string, shown or not shown. What is announced is what is on
          screen, so the two cannot drift into saying different things. */}
      <span className={showLabel ? 'text-sm text-muted-foreground' : 'sr-only'}>{label}</span>
    </div>
  );
}
