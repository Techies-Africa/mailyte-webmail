'use client';

/**
 * Calendar settings: how to reach this calendar from other apps.
 *
 * Two audiences, and they need opposite things.
 *
 * Apps that speak CalDAV -- Apple Calendar, Thunderbird, DAVx5 on Android --
 * want the server address and the mailbox password, and they get a full
 * two-way calendar. That path needs no setup here at all; it is just an
 * address to copy.
 *
 * Outlook does not speak CalDAV, and in its current form gives an IMAP
 * account no calendar at all. The only thing it can follow is a subscription
 * link, which is read-only. Being honest about that difference is the whole
 * job of this screen: a user who copies a link expecting to add events from
 * Outlook and cannot has been misled by us, not by Microsoft.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Plus, Trash2 } from 'lucide-react';
import {
  createSubscription,
  listSubscriptions,
  revokeSubscription,
  type SubscriptionLink,
} from '@/lib/webmail/calendar';
import type { SettingsSectionProps } from './types';

export default function CalendarSettings({ onUnauthorized }: SettingsSectionProps) {
  const [links, setLinks] = useState<SubscriptionLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listSubscriptions(onUnauthorized);
    if (res.success) {
      setLinks(res.data);
      setError(null);
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, [onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    const res = await createSubscription('default', 'Calendar', onUnauthorized);
    setBusy(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    await load();
  }

  async function revoke(token: string) {
    setBusy(true);
    const res = await revokeSubscription(token, onUnauthorized);
    setBusy(false);
    setConfirming(null);
    if (!res.success) {
      setError(res.message);
      return;
    }
    await load();
  }

  async function copy(value: string, token: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(token);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused outright (insecure context, or the
      // user said no). The link is already on screen and selectable, so this
      // is a convenience failing, not the feature failing.
      setError('Could not copy automatically. Select the link and copy it.');
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-1 text-sm font-medium">Apple Calendar, Thunderbird, Android</h3>
        <p className="mb-3 max-w-prose text-sm text-neutral-600 dark:text-neutral-400">
          These apps sync both ways: events you add on your phone appear here,
          and the other way round. Add a <strong>CalDAV</strong> account using
          your email address and your normal mailbox password. Most apps find
          the server from your address alone; if yours asks for a server, give
          it your mail server&rsquo;s address.
        </p>
        <p className="max-w-prose text-sm text-neutral-600 dark:text-neutral-400">
          Android has no built-in CalDAV support. DAVx&#8309; is the usual app for it.
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Outlook</h3>
        <p className="mb-4 max-w-prose text-sm text-neutral-600 dark:text-neutral-400">
          Outlook cannot sync a calendar from a non-Microsoft account. What it
          can do is <strong>subscribe</strong> to a link, which shows your
          events in Outlook but will not let you add or change them there.
          Anyone who has the link can see the events on this calendar, so treat
          it like a password and revoke it if you share it by mistake.
        </p>

        {error && (
          <p className="mb-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-neutral-500">Loading&hellip;</p>
        ) : links.length === 0 ? (
          <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
            No subscription links yet.
          </p>
        ) : (
          <ul className="mb-3 space-y-3">
            {links.map((link) => (
              <li
                key={link.token}
                className="rounded border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <Link2 size={14} className="shrink-0 text-neutral-400" />
                    <span className="truncate">{link.label ?? link.calendar_uri}</span>
                  </span>
                  {confirming === link.token ? (
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => revoke(link.token)}
                        className="rounded bg-rose-600 px-2 py-1 text-white"
                      >
                        Revoke
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="underline">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(link.token)}
                      className="flex shrink-0 items-center gap-1 text-xs text-rose-600 hover:underline dark:text-rose-400"
                    >
                      <Trash2 size={12} /> Revoke
                    </button>
                  )}
                </div>

                {link.url ? (
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
                      {link.url}
                    </code>
                    <button
                      type="button"
                      onClick={() => copy(link.url as string, link.token)}
                      className="flex shrink-0 items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-700"
                    >
                      {copied === link.token ? <Check size={12} /> : <Copy size={12} />}
                      {copied === link.token ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">
                    This server has no public calendar address configured, so the
                    link cannot be shown. Ask your administrator.
                  </p>
                )}

                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  {link.last_accessed_at
                    ? 'Last used by a calendar app recently.'
                    : 'Never used yet.'}
                </p>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="flex items-center gap-1.5 rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <Plus size={15} /> Create a subscription link
        </button>
      </section>
    </div>
  );
}
