'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Forward, X } from 'lucide-react';
import { updateForwarding } from '@/lib/webmail/client';
import { settingsKeys, useForwarding, useSeed } from '@/lib/webmail/query/settingsQueries';
import Button from '@/components/ui/Button';
import { Hint, Switch } from '@/components/ui/Field';
import type { SettingsSectionProps } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches MAX_FORWARD_ADDRESSES on the mail server. */
const MAX_ADDRESSES = 5;

/**
 * Mail forwarding, backed by Sieve `redirect` on the mail server. The two
 * switches mirror what the mechanism does: `redirect :copy` forwards and
 * still delivers here, plain `redirect` forwards instead. There is no third
 * state, so there are only two controls.
 */
export default function ForwardingSettings({ onUnauthorized, onDirty, onSaved }: SettingsSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [keepCopy, setKeepCopy] = useState(true);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [pending, setPending] = useState('');
  const [managed, setManaged] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionError, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Cached: a second visit opens with the saved values already filled in.
  const queryClient = useQueryClient();
  const forwarding = useForwarding(onUnauthorized);
  const [touched, setTouched] = useState(false);
  const seeded = useSeed(forwarding, (data) => {
    setEnabled(data.enabled);
    setKeepCopy(data.keep_copy);
    setAddresses(data.addresses ?? []);
    setManaged(data.managed);
  }, touched);
  const loading = !seeded && !forwarding.isError;
  const error = actionError ?? (!seeded && forwarding.isError ? forwarding.error.message : null);

  const touch = () => {
    setTouched(true);
    setSaved(false);
    onDirty?.();
  };

  const addAddress = (raw: string) => {
    const value = raw.trim().replace(/[,;]$/, '');
    if (value === '') return;
    if (!EMAIL_RE.test(value)) {
      setError(`"${value}" is not a valid email address.`);
      return;
    }
    if (addresses.some((a) => a.toLowerCase() === value.toLowerCase())) {
      setPending('');
      return;
    }
    if (addresses.length >= MAX_ADDRESSES) {
      setError(`You can forward to at most ${MAX_ADDRESSES} addresses.`);
      return;
    }
    setError(null);
    setAddresses((prev) => [...prev, value]);
    setPending('');
    touch();
  };

  const save = async () => {
    setError(null);
    if (enabled && addresses.length === 0) {
      setError('Add an address to forward to, or turn forwarding off.');
      return;
    }
    setSaving(true);
    const result = await updateForwarding({ enabled, addresses, keep_copy: keepCopy }, onUnauthorized);
    setSaving(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setManaged(true);
    setTouched(false);
    if (result.data) queryClient.setQueryData(settingsKeys.forwarding, result.data);
    onSaved?.();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading forwarding…</p>;
  }

  return (
    <div className="space-y-6" data-shortcuts="off">
      {!managed && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/[0.12] px-3 py-2.5 text-sm text-warning">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>This mailbox already has a forwarding rule that was not created here. Saving below replaces it.</span>
        </p>
      )}

      <Switch
        checked={enabled}
        onChange={(next) => {
          setEnabled(next);
          touch();
        }}
        label="Forward incoming messages"
      />

      <div className={enabled ? 'space-y-5' : 'pointer-events-none space-y-5 opacity-50'}>
        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold">Forward to</p>
          <div className="flex min-h-[2.5rem] max-w-lg flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
            {addresses.map((address, index) => (
              <span key={address} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 font-mono text-[12px]">
                <span className="max-w-[16rem] truncate">{address}</span>
                <button
                  type="button"
                  onClick={() => {
                    setAddresses((prev) => prev.filter((_, i) => i !== index));
                    touch();
                  }}
                  className="rounded-full p-0.5 hover:bg-foreground/10"
                  aria-label={`Remove ${address}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              value={pending}
              onChange={(e) => setPending(e.target.value)}
              onKeyDown={(e) => {
                if ([',', ';', 'Enter', 'Tab'].includes(e.key) && pending.trim() !== '') {
                  e.preventDefault();
                  addAddress(pending);
                }
              }}
              onBlur={() => pending.trim() !== '' && addAddress(pending)}
              placeholder={addresses.length === 0 ? 'name@example.com' : 'Add another'}
              className="min-w-[10rem] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/70"
              aria-label="Forwarding address"
            />
          </div>
          <Hint>Up to {MAX_ADDRESSES} addresses. Press Enter after each one.</Hint>
        </div>

        <div>
          <Switch
            checked={keepCopy}
            onChange={(next) => {
              setKeepCopy(next);
              touch();
            }}
            label="Keep a copy in this mailbox"
          />
          <Hint className="ml-12">
            With this off, forwarded mail is not delivered here at all — it only goes to the addresses above.
          </Hint>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-5">
        <Button variant="primary" size="md" busy={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save forwarding'}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check size={14} /> Saved
          </span>
        )}
        {enabled && addresses.length > 0 && !saved && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Forward size={13} />
            {keepCopy ? 'Delivered here and forwarded' : 'Forwarded only'}
          </span>
        )}
      </div>
    </div>
  );
}
