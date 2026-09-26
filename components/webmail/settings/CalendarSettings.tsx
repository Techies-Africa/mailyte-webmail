'use client';

/**
 * Calendar settings: how to reach this calendar from other apps.
 *
 * Apps that speak CalDAV want the server address and the mailbox password,
 * and get a full two-way calendar. Outlook does not speak CalDAV; the only
 * thing it can follow is a subscription link, which is read-only. Being
 * honest about that difference is the whole job of this screen.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Plus, Trash2 } from 'lucide-react';
import { createSubscription, revokeSubscription, type SubscriptionLink } from '@/lib/webmail/calendar';
import { settingsKeys, useSubscriptions } from '@/lib/webmail/query/settingsQueries';
import Button from '@/components/ui/Button';
import type { SettingsSectionProps } from './types';

const NO_LINKS: SubscriptionLink[] = [];

export default function CalendarSettings({ onUnauthorized }: SettingsSectionProps) {
  // Cached: the links are there at once on a second visit.
  const queryClient = useQueryClient();
  const subscriptions = useSubscriptions(onUnauthorized);
  const links = subscriptions.data ?? NO_LINKS;
  const loading = subscriptions.isPending && !subscriptions.isError;
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? (subscriptions.isError ? subscriptions.error.message : null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    const res = await createSubscription('default', 'Calendar', onUnauthorized);
    setBusy(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    setError(null);
    // The new link, from the answer: no second request to list them all again.
    queryClient.setQueryData<SubscriptionLink[]>(settingsKeys.subscriptions, (list) => [...(list ?? []), res.data]);
    void queryClient.invalidateQueries({ queryKey: settingsKeys.subscriptions });
  }

  /**
   * Off the list at once. A refusal puts it back and says so plainly: a
   * revoke that did not happen leaves a working link in someone's calendar.
   */
  async function revoke(token: string) {
    setConfirming(null);
    setError(null);
    const link = queryClient.getQueryData<SubscriptionLink[]>(settingsKeys.subscriptions)?.find((l) => l.token === token);
    queryClient.setQueryData<SubscriptionLink[]>(settingsKeys.subscriptions, (list) => list?.filter((l) => l.token !== token));
    const res = await revokeSubscription(token, onUnauthorized);
    if (!res.success) {
      // Only this link comes back; one revoked or made meanwhile keeps its state.
      queryClient.setQueryData<SubscriptionLink[]>(settingsKeys.subscriptions, (list) =>
        link && list && !list.some((l) => l.token === token) ? [...list, link] : list,
      );
      void queryClient.invalidateQueries({ queryKey: settingsKeys.subscriptions });
      setError(`That link was NOT revoked and still works: ${res.message}`);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: settingsKeys.subscriptions });
  }

  async function copy(value: string, token: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(token);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy automatically. Select the link and copy it.');
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-1 font-display text-[14px] font-semibold">Apple Calendar, Thunderbird, Android</h3>
        <p className="mb-3 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          These apps sync both ways: events you add on your phone appear here, and the other way round. Add a{' '}
          <strong className="text-foreground">CalDAV</strong> account using your email address and your normal mailbox
          password. Most apps find the server from your address alone; if yours asks for a server, give it your mail
          server&rsquo;s address.
        </p>
        <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Android has no built-in CalDAV support. DAVx&#8309; is the usual app for it.
        </p>
      </section>

      <section>
        <h3 className="mb-1 font-display text-[14px] font-semibold">Outlook</h3>
        <p className="mb-4 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Outlook cannot sync a calendar from a non-Microsoft account. What it can do is{' '}
          <strong className="text-foreground">subscribe</strong> to a link, which shows your events in Outlook but will
          not let you add or change them there. Anyone who has the link can see the events on this calendar, so treat
          it like a password and revoke it if you share it by mistake.
        </p>

        {error && (
          <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading&hellip;</p>
        ) : links.length === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">No subscription links yet.</p>
        ) : (
          <ul className="mb-3 space-y-3">
            {links.map((link) => (
              <li key={link.token} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    <Link2 size={14} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{link.label ?? link.calendar_uri}</span>
                  </span>
                  {confirming === link.token ? (
                    <span className="flex shrink-0 items-center gap-2">
                      <Button size="xs" variant="danger" disabled={busy} onClick={() => revoke(link.token)}>
                        Revoke
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(link.token)}
                      className="flex shrink-0 items-center gap-1 text-xs font-semibold text-destructive hover:underline"
                    >
                      <Trash2 size={12} /> Revoke
                    </button>
                  )}
                </div>

                {link.url ? (
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">{link.url}</code>
                    <Button size="xs" icon={copied === link.token ? <Check size={12} /> : <Copy size={12} />} onClick={() => copy(link.url as string, link.token)}>
                      {copied === link.token ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This server has no public calendar address configured, so the link cannot be shown. Ask your
                    administrator.
                  </p>
                )}

                <p className="mt-2 text-xs text-muted-foreground">
                  {link.last_accessed_at ? 'Last used by a calendar app recently.' : 'Never used yet.'}
                </p>
              </li>
            ))}
          </ul>
        )}

        <Button variant="primary" size="md" icon={<Plus size={14} />} busy={busy} onClick={create}>
          Create a subscription link
        </Button>
      </section>
    </div>
  );
}
