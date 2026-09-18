import { useEffect, useState } from 'react';
import { HardDrive, PenLine, Check, AtSign } from 'lucide-react';
import WebmailEditor from '../WebmailEditor';
import { updateSettings } from '@/lib/webmail/client';
import type { SettingsSectionProps } from './types';

function formatMb(mb: number): string {
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * Signature, list density and storage.
 *
 * The signature is sanitised server-side on save (SignatureSanitizer), so
 * this re-reads after saving rather than trusting the local copy -- what was
 * sent is not necessarily what was stored.
 */
export default function GeneralSettings({
  settings,
  onUnauthorized,
  onDirty,
  onSaved,
  onSettingsChanged,
}: SettingsSectionProps) {
  const [name, setName] = useState(settings.name ?? '');
  const [signature, setSignature] = useState(settings.signatureHtml);
  const [onReply, setOnReply] = useState(settings.signatureOnReply);
  const [density, setDensity] = useState(settings.displayDensity);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(settings.name ?? '');
    setSignature(settings.signatureHtml);
    setOnReply(settings.signatureOnReply);
    setDensity(settings.displayDensity);
  }, [settings]);

  const save = async () => {
    // Refused here as well as on the server, so the person is told before the
    // round trip rather than after it. The server rejects a blank name because
    // an empty display name is not a setting -- it is the absence of one, and
    // it would strip the name off every message they send.
    if (name.trim() === '') {
      setError('Enter the name recipients should see, or leave your current one in place.');
      return;
    }

    setSaving(true);
    setError(null);
    const result = await updateSettings(
      {
        name: name.trim(),
        signature_html: signature,
        signature_on_reply: onReply,
        display_density: density,
      },
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
    <div className="space-y-6" data-shortcuts="off">
      {/*
        The From line, which was both invisible and unreachable.

        The display name reached this payload as null for every mailbox -- the
        mail server's session query never selected it -- so mail went out as a
        bare address and nobody could see why.

        Editable by the holder, not just by an admin. It is their name on their
        mail; an address book entry that can only be corrected by filing a
        ticket is one that stays wrong. The admin path still exists and still
        wins at provisioning time, and ReconcileMailboxesJob pulls a change
        made here back into Laravel so the two copies cannot drift apart.
      */}
      <section>
        <label
          htmlFor="display-name"
          className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
        >
          <AtSign size={15} /> Display name
        </label>
        <input
          id="display-name"
          type="text"
          value={name}
          maxLength={255}
          onChange={(e) => {
            setName(e.target.value);
            onDirty?.();
          }}
          placeholder="Your name"
          className="w-full max-w-sm text-sm px-2.5 py-1.5 rounded border border-border bg-transparent"
        />
        <p className="mt-1.5 text-xs text-gray-500 break-all">
          Recipients see{' '}
          <span className="font-mono">
            {name.trim() ? `${name.trim()} <${settings.emailAddress}>` : settings.emailAddress}
          </span>
          . Takes effect on your next message.
        </p>
      </section>

      <section>
        <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          <PenLine size={15} /> Signature
        </h3>
        <div className="border border-border rounded-md overflow-hidden">
          <WebmailEditor
            initialHtml={settings.signatureHtml}
            placeholder="Your name, role, a link…"
            onChange={(html) => {
              setSignature(html);
              onDirty?.();
            }}
          />
        </div>
        <label className="flex items-center gap-2 mt-2 text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={onReply}
            onChange={(e) => {
              setOnReply(e.target.checked);
              onDirty?.();
            }}
            className="rounded border-gray-300 dark:border-gray-600"
          />
          Include the signature on replies
        </label>
      </section>

      <section>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Message list density
        </h3>
        <div className="flex gap-2">
          {(['comfortable', 'compact'] as const).map((option) => (
            <button
              key={option}
              onClick={() => {
                setDensity(option);
                onDirty?.();
              }}
              className={`px-3 py-1.5 text-sm rounded-md border capitalize ${
                density === option
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          <HardDrive size={15} /> Storage
        </h3>
        {quotaMb > 0 ? (
          <>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  (percentage ?? 0) >= 90
                    ? 'bg-red-500'
                    : (percentage ?? 0) >= 75
                      ? 'bg-amber-500'
                      : 'bg-primary'
                }`}
                style={{ width: `${Math.min(100, percentage ?? 0)}%` }}
              />
            </div>
            <p className="mt-1.5 text-sm text-gray-500">
              {formatMb(usedMb)} of {formatMb(quotaMb)} used
              {percentage !== null && ` (${percentage}%)`}
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500">
            {formatMb(usedMb)} used — this mailbox has no quota set.
          </p>
        )}
      </section>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="px-4 py-1.5 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <Check size={14} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
