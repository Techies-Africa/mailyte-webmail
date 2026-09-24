'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, X } from 'lucide-react';
import { blockSender, getBlockedSenders, unblockSender, type ApiBlockedSenders } from '@/lib/webmail/client';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import type { SettingsSectionProps } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Blocked senders.
 *
 * The mail server files anything from these addresses into Junk at delivery,
 * before rules, forwarding and the vacation reply run. Nothing is discarded.
 * Each change is written straight away -- there is no form to save, because
 * the list IS the setting.
 */
export default function BlockedSendersSettings({ onUnauthorized }: SettingsSectionProps) {
  const { toast } = useToast();
  const [state, setState] = useState<ApiBlockedSenders | null>(null);
  const [pending, setPending] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void getBlockedSenders(onUnauthorized).then((result) => {
      if (result.success && result.data) setState(result.data);
      else if (!result.success) setLoadError(result.message);
    });
  }, [onUnauthorized]);

  const add = async () => {
    const address = pending.trim().toLowerCase();
    if (!EMAIL_RE.test(address)) {
      setError('Enter a full email address, like name@example.com.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await blockSender(address, onUnauthorized);
    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    if (result.data) setState(result.data);
    setPending('');
    toast(`Blocked ${address}`);
  };

  const remove = async (address: string) => {
    setBusy(true);
    setError(null);
    const result = await unblockSender(address, onUnauthorized);
    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    if (result.data) setState(result.data);
    toast(`Unblocked ${address}`);
  };

  if (loadError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {loadError}
      </p>
    );
  }

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading blocked senders…</p>;
  }

  return (
    <div className="space-y-6" data-shortcuts="off">
      <section>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Mail from a blocked address goes straight to <span className="font-semibold text-foreground">{state.folder}</span>{' '}
          when it arrives. It is filed, not deleted, so a mistake costs nothing. You can also block someone from the
          menu on any message.
        </p>
        {!state.managed && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/[0.12] px-3 py-2.5 text-sm text-warning">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              This mailbox already has a blocked-senders rule that was not created here. The first change below
              replaces it.
            </span>
          </p>
        )}
      </section>

      <section>
        <div className="flex gap-2">
          <Input
            value={pending}
            onChange={(e) => {
              setPending(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
            placeholder="name@example.com"
            aria-label="Address to block"
            autoComplete="off"
            className="max-w-sm"
            disabled={busy}
          />
          <Button variant="primary" size="md" icon={<Ban size={13} />} busy={busy} onClick={() => void add()} disabled={pending.trim() === ''}>
            Block
          </Button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">
          Blocked addresses{' '}
          <span className="font-normal text-muted-foreground">
            {state.addresses.length} of {state.limit}
          </span>
        </h3>
        {state.addresses.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nobody is blocked.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {state.addresses.map((address) => (
              <li key={address} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0 truncate font-mono text-[12.5px]">{address}</span>
                <button
                  type="button"
                  onClick={() => void remove(address)}
                  disabled={busy}
                  className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <X size={12} /> Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
