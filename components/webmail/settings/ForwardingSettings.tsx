import { useEffect, useState } from 'react';
import { AlertTriangle, Forward, X } from 'lucide-react';
import { getForwarding, updateForwarding } from '@/lib/webmail/client';
import type { SettingsSectionProps } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches MAX_FORWARD_ADDRESSES in MailboxRulesController. */
const MAX_ADDRESSES = 5;

/**
 * Mail forwarding.
 *
 * Backed by Sieve `redirect` on the mail server, not the local
 * `email_forwarding_rules` table -- that one never touched the mail server,
 * so anything saved to it forwarded nothing.
 *
 * The two switches mirror what the mechanism actually does: `redirect :copy`
 * forwards and still delivers here, plain `redirect` forwards instead of
 * delivering here. There is no third state, so there are only two controls.
 */
export default function ForwardingSettings({
  onUnauthorized,
  onDirty,
  onSaved,
}: SettingsSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [keepCopy, setKeepCopy] = useState(true);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [pending, setPending] = useState('');
  const [managed, setManaged] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getForwarding(onUnauthorized).then((result) => {
      if (result.success) {
        setEnabled(result.data.enabled);
        setKeepCopy(result.data.keep_copy);
        setAddresses(result.data.addresses ?? []);
        setManaged(result.data.managed);
      } else {
        setError(result.message);
      }
      setLoading(false);
    });
  }, [onUnauthorized]);

  const touch = () => {
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
    onSaved?.();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Loading forwarding…</p>;
  }

  return (
    <div className="space-y-5" data-shortcuts="off">
      {!managed && (
        <p className="flex items-start gap-2 text-sm rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 p-3">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <span>
            This mailbox already has a forwarding rule that was not created here. Saving below
            replaces it.
          </span>
        </p>
      )}

      <label className="flex items-center gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            touch();
          }}
          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary"
        />
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
          Forward incoming messages
        </span>
      </label>

      <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>
        <p className="text-xs text-gray-500 mb-1.5">Forward to</p>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 dark:border-gray-700 pb-2">
          {addresses.map((address, index) => (
            <span
              key={address}
              className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-200"
            >
              <span className="truncate max-w-[16rem]">{address}</span>
              <button
                onClick={() => {
                  setAddresses((prev) => prev.filter((_, i) => i !== index));
                  touch();
                }}
                className="p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                aria-label={`Remove ${address}`}
              >
                <X size={12} />
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
            className="flex-1 min-w-[12rem] bg-transparent text-sm py-1 focus:outline-none"
            aria-label="Forwarding address"
          />
        </div>

        <label className="flex items-start gap-2.5 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={keepCopy}
            onChange={(e) => {
              setKeepCopy(e.target.checked);
              touch();
            }}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary"
          />
          <span>
            <span className="block text-sm text-gray-800 dark:text-gray-200">
              Keep a copy in this mailbox
            </span>
            <span className="block text-xs text-gray-500">
              With this off, forwarded mail is not delivered here at all — it only goes to the
              addresses above.
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="px-4 py-1.5 text-sm rounded-md bg-primary text-black disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save forwarding'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
        {enabled && addresses.length > 0 && !saved && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <Forward size={13} />
            {keepCopy ? 'Delivered here and forwarded' : 'Forwarded only'}
          </span>
        )}
      </div>
    </div>
  );
}
