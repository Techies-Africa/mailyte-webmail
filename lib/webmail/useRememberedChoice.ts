'use client';

import { useCallback, useEffect, useState } from 'react';

/** Which calendar the calendar screen last showed, per mailbox. */
export const CALENDAR_CHOICE_KEY = 'mailyte.webmail.calendar';
/** Which address book the contacts screen last showed, per mailbox. */
export const ADDRESS_BOOK_CHOICE_KEY = 'mailyte.webmail.addressBook';

/**
 * A choice remembered per mailbox: the calendar or address book this person
 * last picked, so coming back opens on it rather than on the server default.
 *
 * Stored as one JSON map of lowercased address to uri under `key`, because
 * one browser can hold several signed-in mailboxes and one person's "Team"
 * calendar means nothing in another's.
 *
 * The value is `undefined` until storage has been read (the effect after the
 * first render), and callers wait on it: a screen that fetched the default
 * calendar's events and then the remembered one's would fetch twice and
 * flash the wrong week. With no mailbox known (`scope` null) it is null at
 * once, so nothing hangs; a pick still holds for the visit.
 */
export function useRememberedChoice(
  key: string,
  scope: string | null,
): [string | null | undefined, (next: string) => void] {
  const slot = scope?.trim().toLowerCase() ?? '';
  const [read, setRead] = useState<{ slot: string; value: string | null } | null>(null);

  useEffect(() => {
    if (!slot) return;
    let value: string | null = null;
    try {
      const all: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}');
      const hit = all && typeof all === 'object' ? (all as Record<string, unknown>)[slot] : null;
      value = typeof hit === 'string' && hit ? hit : null;
    } catch {
      // Private mode, or something this version did not write: nothing remembered.
    }
    // Reading storage is a side effect, which is what an effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRead({ slot, value });
  }, [key, slot]);

  const remember = useCallback(
    (next: string) => {
      setRead({ slot, value: next });
      if (!slot) return;
      try {
        const all: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}');
        const map = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
        window.localStorage.setItem(key, JSON.stringify({ ...map, [slot]: next }));
      } catch {
        // Not worth failing a click over.
      }
    },
    [key, slot],
  );

  // A read for another mailbox (the account just changed) is not this one's answer.
  const value = read?.slot === slot ? read.value : slot ? undefined : null;
  return [value, remember];
}
