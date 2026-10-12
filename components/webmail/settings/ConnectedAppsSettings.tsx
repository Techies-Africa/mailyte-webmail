'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Unplug } from 'lucide-react';
import { disconnectApp, setAppSendLimit, type ApiConnectedApp } from '@/lib/webmail/client';
import { settingsKeys, useConnectedApps } from '@/lib/webmail/query/settingsQueries';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import type { SettingsSectionProps } from './types';

function when(iso: string | null): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'never'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * AI apps (ChatGPT, Claude) this mailbox holder has connected, from the
 * approve page at /connect/authorize. Each one: what it may do, how many
 * emails it may send a day, and Disconnect, which ends its access at once.
 * Changes save straight away -- the list IS the setting.
 */
export default function ConnectedAppsSettings({ onUnauthorized }: SettingsSectionProps) {
  const query = useConnectedApps(onUnauthorized);
  const apps = query.data ?? null;
  const loadError = !apps && query.isError ? query.error.message : null;

  if (loadError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {loadError}
      </p>
    );
  }
  if (!apps) return <p className="text-sm text-muted-foreground">Loading connected apps…</p>;

  return (
    <div className="space-y-6" data-shortcuts="off">
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        AI apps you allowed to use this mailbox. To add one, connect Mailyte Mail from inside ChatGPT or Claude.
      </p>
      {apps.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No apps are connected.
        </p>
      ) : (
        <ul className="space-y-3">
          {apps.map((app) => (
            <ConnectedAppRow key={app.id} app={app} onUnauthorized={onUnauthorized} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectedAppRow({ app, onUnauthorized }: { app: ApiConnectedApp; onUnauthorized: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(String(app.daily_send_cap));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = app.access.some((a) => a.scope === 'mail:send');
  const changed = limit.trim() !== String(app.daily_send_cap);

  const saveLimit = async () => {
    const value = Number(limit);
    if (!Number.isInteger(value) || value < 0 || value > 1000) {
      setError('Enter a whole number from 0 to 1000.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await setAppSendLimit(app.id, value, onUnauthorized);
    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: settingsKeys.connectedApps });
    toast(value === 0 ? `${app.app.name} can no longer send` : `${app.app.name} can send ${value} a day`);
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    const result = await disconnectApp(app.id, onUnauthorized);
    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    queryClient.setQueryData<ApiConnectedApp[]>(settingsKeys.connectedApps, (current) =>
      (current ?? []).filter((a) => a.id !== app.id),
    );
    toast(`Disconnected ${app.app.name}`);
  };

  return (
    <li className="rounded-lg border border-border px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <span className="truncate">{app.app.name}</span>
            {app.app.verified && <ShieldCheck size={13} className="shrink-0 text-success" aria-label="Verified" />}
          </div>
          <div className="text-xs text-muted-foreground">Last used {when(app.last_used_at)}</div>
        </div>
        <Button variant="secondary" size="sm" icon={<Unplug size={13} />} busy={busy} onClick={() => void disconnect()}>
          Disconnect
        </Button>
      </div>

      <ul className="mt-3 space-y-1 text-[13px] text-foreground">
        {app.access.map((a) => (
          <li key={a.scope}>{a.label}</li>
        ))}
      </ul>

      {canSend && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">Emails it may send a day</span>
          <Input
            value={limit}
            onChange={(e) => {
              setLimit(e.target.value);
              setError(null);
            }}
            inputMode="numeric"
            aria-label={`Emails ${app.app.name} may send a day`}
            className="w-20"
            disabled={busy}
          />
          {changed && (
            <Button variant="primary" size="sm" busy={busy} onClick={() => void saveLimit()}>
              Save
            </Button>
          )}
          <span className="text-xs text-muted-foreground">{app.sent_today} sent today</span>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
