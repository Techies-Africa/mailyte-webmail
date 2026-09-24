'use client';

/**
 * Calendar settings: how to reach this calendar from other apps.
 *
 * Apps that speak CalDAV want the server address and the mailbox password,
 * and get a full two-way calendar. Outlook does not speak CalDAV; the only
 * thing it can follow is a subscription link, which is read-only. Being
 * honest about that difference is the whole job of this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Plus, Trash2 } from 'lucide-react';
import { createSubscription, listSubscriptions, revokeSubscription, type SubscriptionLink } from '@/lib/webmail/calendar';
import Button from '@/components/ui/Button';
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
    if (res.success && Array.isArray(res.data)) {
      setLinks(res.data);
      setError(null);
    } else if (!res.success) {
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
