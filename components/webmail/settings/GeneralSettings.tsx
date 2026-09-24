'use client';

import { useEffect, useState } from 'react';
import { HardDrive, PenLine, Check, AtSign, Rows3 } from 'lucide-react';
import WebmailEditor from '../WebmailEditor';
import { updateSettings } from '@/lib/webmail/client';
import Button from '@/components/ui/Button';
import { Hint, Input, Label, Switch } from '@/components/ui/Field';
import type { SettingsSectionProps } from './types';

function formatMb(mb: number): string {
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 font-display text-[14px] font-semibold">
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </h3>
  );
}

/**
 * Display name, signature, list density and storage.
 *
 * The signature is sanitised server-side on save, so this re-reads after
 * saving rather than trusting the local copy.
 */
export default function GeneralSettings({ settings, onUnauthorized, onDirty, onSaved, onSettingsChanged }: SettingsSectionProps) {
  const [name, setName] = useState(settings.name ?? '');
  const [signature, setSignature] = useState(settings.signatureHtml);
  const [onReply, setOnReply] = useState(settings.signatureOnReply);
  const [density, setDensity] = useState(settings.displayDensity);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Re-seed from the server copy after a save re-reads it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(settings.name ?? '');
    setSignature(settings.signatureHtml);
    setOnReply(settings.signatureOnReply);
    setDensity(settings.displayDensity);
  }, [settings]);

  const save = async () => {
    // Refused here as well as on the server: a blank display name is not a
    // setting, it is the absence of one, and would strip the name off every
    // message they send.
    if (name.trim() === '') {
      setError('Enter the name recipients should see, or leave your current one in place.');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await updateSettings(
      { name: name.trim(), signature_html: signature, signature_on_reply: onReply, display_density: density },
      onUnauthorized,
    );
    setSaving(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    onSettingsChanged?.();
    onSaved?.();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const { usedMb, quotaMb, percentage } = settings.storage;

  return (
    <div className="space-y-8" data-shortcuts="off">
      <section>
        <SectionTitle icon={<AtSign size={15} />}>Display name</SectionTitle>
        <Label htmlFor="display-name">Recipients see this beside your address</Label>
        <Input
          id="display-name"
          value={name}
          maxLength={255}
          onChange={(e) => {
            setName(e.target.value);
            onDirty?.();
          }}
          placeholder="Your name"
          className="max-w-sm"
        />
        <Hint>
          Mail goes out as{' '}
          <span className="font-mono text-foreground">
            {name.trim() ? `${name.trim()} <${settings.emailAddress}>` : settings.emailAddress}
          </span>
          . Takes effect on your next message.
        </Hint>
      </section>

      <section>
        <SectionTitle icon={<PenLine size={15} />}>Signature</SectionTitle>
        <div className="overflow-hidden rounded-lg border border-border">
          <WebmailEditor
            initialHtml={settings.signatureHtml}
            placeholder="Your name, role, a link…"
            autoFocus={false}
            minHeightClass="min-h-[8rem]"
            onChange={(html) => {
              setSignature(html);
              onDirty?.();
            }}
          />
        </div>
        <div className="mt-3">
          <Switch
            checked={onReply}
            onChange={(next) => {
              setOnReply(next);
              onDirty?.();
            }}
            label="Include the signature on replies"
          />
        </div>
      </section>

      <section>
        <SectionTitle icon={<Rows3 size={15} />}>Message list</SectionTitle>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(['comfortable', 'compact'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={density === option}
              onClick={() => {
                setDensity(option);
                onDirty?.();
              }}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold capitalize transition-colors ${
                density === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <Hint>Compact hides the preview line and tightens each row.</Hint>
      </section>

      <section>
        <SectionTitle icon={<HardDrive size={15} />}>Storage</SectionTitle>
        {quotaMb > 0 ? (
          <>
            <div className="h-2 max-w-md overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${
                  (percentage ?? 0) >= 90 ? 'bg-destructive' : (percentage ?? 0) >= 75 ? 'bg-warning' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(100, percentage ?? 0)}%` }}
              />
            </div>
            <Hint>
              {formatMb(usedMb)} of {formatMb(quotaMb)} used{percentage !== null && ` (${percentage}%)`}
            </Hint>
          </>
        ) : (
          <Hint>{formatMb(usedMb)} used — this mailbox has no quota set.</Hint>
        )}
      </section>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-5">
        <Button variant="primary" size="md" busy={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check size={14} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
