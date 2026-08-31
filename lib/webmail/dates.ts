// Every date the webmail shows a person is formatted here, with date-fns --
// never with Date.prototype.toLocaleString().
//
// Two pages crashed to Next's error screen on an Android phone -- Reply, and
// Settings > Security -- and nothing else did. What they had in common was a
// bare `toLocaleString()`. With no locale argument, V8 formats in the
// browser's DEFAULT locale, and on some devices that value is malformed
// ("en-US@posix" and friends; Chromium issue 41447743, V8 issue 12723), so
// every Intl call that does not name a locale throws
// `RangeError: Incorrect locale information provided`. The reading pane
// passed 'en-US' explicitly and rendered fine on the same phone; the message
// list used date-fns and was fine too.
//
// date-fns formats from its own en-US data and never consults Intl, so this
// cannot recur. The cost is that dates read in US English for everyone -- the
// list already did that, so this makes the app consistent rather than less
// local.
//
// Every helper tolerates an invalid Date. `toLocaleString()` on one returns
// the string "Invalid Date"; date-fns' `format` THROWS -- and a malformed
// header from some sender is not a reason to take the page down.

import { format, isValid } from 'date-fns';

function safe(date: Date, pattern: string): string {
  return isValid(date) ? format(date, pattern) : '—';
}

/** "Aug 25, 2026, 8:24 AM" -- sign-in history, thread rows, summaries. */
export function formatDateTime(date: Date): string {
  return safe(date, 'MMM d, yyyy, h:mm a');
}

/** "Aug 25, 8:24 AM" -- the open message's header, where the year is noise. */
export function formatShortDateTime(date: Date): string {
  return safe(date, 'MMM d, h:mm a');
}

/** "8:24 AM" -- the "Draft saved" footer. */
export function formatTime(date: Date): string {
  return safe(date, 'h:mm a');
}

/** "Mon, Aug 25, 2026 at 8:24 AM" -- the "On …, X wrote:" line above a quotation. */
export function formatQuoteDate(date: Date): string {
  return safe(date, "EEE, MMM d, yyyy 'at' h:mm a");
}
