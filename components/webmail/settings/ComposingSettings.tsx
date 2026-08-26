import { useEffect, useState } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { updateSettings } from '@/lib/webmail/client';
import type { SettingsSectionProps } from './types';

/** Must match UNDO_SECONDS_CHOICES in MailboxSettingsController. */
const WINDOW_CHOICES = [5, 10, 20, 30] as const;

/**
 * How composing and sending behave.
 *
 * Undo-send is OFF by default and opt-in. The delay is not free -- it
 * applies to every message the mailbox sends, so someone who never wants to
 * recall one should not pay for the option. The PRD originally fixed this at
 * always-on/10s; that was changed to off-by-default/5s after using it.
 */
export default function ComposingSettings({
  settings,
  onUnauthorized,
  onDirty,
  onSaved,
  onSettingsChanged,
}: SettingsSectionProps) {
  const [enabled, setEnabled] = useState(settings.undoSendEnabled);
  const [seconds, setSeconds] = useState(settings.undoSendSeconds);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(settings.undoSendEnabled);
    setSeconds(settings.undoSendSeconds);
  }, [settings]);

  const touch = () => {
    setSaved(false);
    onDirty?.();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await updateSettings(
      { undo_send_enabled: enabled, undo_send_seconds: seconds },
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

  return (
    <div className="space-y-5" data-shortcuts="off">
      <section>
        <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          <Undo2 size={15} /> Undo send
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Hold each message briefly after you press Send, so you can take it back. Nothing
          leaves this server until the countdown finishes.
        </p>

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
          <span className="text-sm text-gray-800 dark:text-gray-200">
            Give me a chance to undo sending
          </span>
        </label>

        <div className={`mt-3 ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <p className="text-xs text-gray-500 mb-1.5">Hold for</p>
          <div className="flex flex-wrap gap-2">
            {WINDOW_CHOICES.map((choice) => (
              <button
                key={choice}
                onClick={() => {
                  setSeconds(choice);
                  touch();
                }}
                aria-pressed={seconds === choice}
                className={`px-3 py-1.5 text-sm rounded-md border ${
                  seconds === choice
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                {choice} seconds
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Every message waits this long before it is sent.
          </p>
        </div>
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
          className="px-4 py-1.5 text-sm rounded-md bg-primary text-black disabled:opacity-50"
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
