'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { updateSettings } from '@/lib/webmail/client';
import Button from '@/components/ui/Button';
import { Hint, Switch } from '@/components/ui/Field';
import type { SettingsSectionProps } from './types';

/** Must match UNDO_SECONDS_CHOICES on the mail server. */
const WINDOW_CHOICES = [5, 10, 20, 30] as const;

/**
 * How composing and sending behave.
 *
 * Undo-send is OFF by default and opt-in: the delay applies to every message
 * the mailbox sends, so someone who never wants to recall one should not pay
 * for the option.
 */
export default function ComposingSettings({ settings, onUnauthorized, onDirty, onSaved, onSettingsChanged }: SettingsSectionProps) {
  const [enabled, setEnabled] = useState(settings.undoSendEnabled);
  const [seconds, setSeconds] = useState(settings.undoSendSeconds);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follows the server copy while untouched, and after this form's own
  // save; never over an edit in progress.
  const reseedAfterSave = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current && !reseedAfterSave.current) return;
    reseedAfterSave.current = false;
    touched.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(settings.undoSendEnabled);
    setSeconds(settings.undoSendSeconds);
  }, [settings]);

  const touch = () => {
    touched.current = true;
    setSaved(false);
    onDirty?.();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await updateSettings({ undo_send_enabled: enabled, undo_send_seconds: seconds }, onUnauthorized);
    setSaving(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    reseedAfterSave.current = true;
    onSettingsChanged?.();
    onSaved?.();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-6" data-shortcuts="off">
      <section>
        <h3 className="mb-1 flex items-center gap-2 font-display text-[14px] font-semibold">
          <Undo2 size={15} className="text-muted-foreground" /> Undo send
        </h3>
        <p className="mb-4 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Hold each message briefly after you press Send, so you can take it back. Nothing leaves this server until
          the countdown finishes.
        </p>

        <Switch
          checked={enabled}
          onChange={(next) => {
            setEnabled(next);
            touch();
          }}
          label="Give me a chance to undo sending"
        />

        <div className={`mt-4 ${enabled ? '' : 'pointer-events-none opacity-50'}`}>
          <p className="mb-2 text-[12.5px] font-semibold">Hold for</p>
          <div className="inline-flex flex-wrap rounded-lg border border-border p-0.5">
            {WINDOW_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => {
                  setSeconds(choice);
                  touch();
                }}
                aria-pressed={seconds === choice}
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  seconds === choice ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {choice} seconds
              </button>
            ))}
          </div>
          <Hint>Every message waits this long before it is sent.</Hint>
        </div>
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
