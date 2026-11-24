'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Eye, Undo2 } from 'lucide-react';
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
  // Offered only when the mail server sends them (see WebmailSettings.trackOpens):
  // a server without the feature must never be shown switches it would ignore.
  const trackingOffered = settings.trackOpens !== undefined;
  const [trackOpens, setTrackOpens] = useState(settings.trackOpens ?? false);
  const [trackClicks, setTrackClicks] = useState(settings.trackClicks ?? false);
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
    setTrackOpens(settings.trackOpens ?? false);
    setTrackClicks(settings.trackClicks ?? false);
  }, [settings]);

  const touch = () => {
    touched.current = true;
    setSaved(false);
    onDirty?.();
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await updateSettings(
      {
        undo_send_enabled: enabled,
        undo_send_seconds: seconds,
        ...(trackingOffered ? { track_opens: trackOpens, track_clicks: trackClicks } : {}),
      },
      onUnauthorized,
    );
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

      {trackingOffered && (
        <section>
          <h3 className="mb-1 flex items-center gap-2 font-display text-[14px] font-semibold">
            <Eye size={15} className="text-muted-foreground" /> Track sent emails
          </h3>
          <p className="mb-4 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            See when someone opens an email you sent, and when they click a link in it. Both are off until you turn
            them on. It only works for emails you send after turning it on, and the people you write to are not told.
          </p>

          <div className="space-y-4">
            <div>
              <Switch
                checked={trackOpens}
                onChange={(next) => {
                  setTrackOpens(next);
                  touch();
                }}
                label="Tell me when my emails are opened"
              />
              <Hint>A good guide, not an exact count.</Hint>
            </div>
            <div>
              <Switch
                checked={trackClicks}
                onChange={(next) => {
                  setTrackClicks(next);
                  touch();
                }}
                label="Tell me when links in my emails are clicked"
              />
              <Hint>
                Some inboxes are a little more likely to send emails with tracked links to spam, so turn this on only if
                you need it.
              </Hint>
            </div>
          </div>
          <Hint className="mt-4">
            Tracking on or off, an email in Sent always shows whether it was delivered and how likely it is to land in
            spam.
          </Hint>

          <details className="group mt-4 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
              How accurate is this?
              <ChevronDown size={15} className="text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <dl className="mt-2.5 space-y-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
              <div>
                <dt className="font-semibold text-foreground">Opens are a good guide, not exact</dt>
                <dd>
                  Some email apps hide images, so an open can be missed. Others load images automatically (Apple Mail
                  does, even if nobody reads the email), so an open can be counted by mistake. We ignore anything
                  in the first 10 seconds after you send, which is almost always a mail service checking. &ldquo;None
                  recorded&rdquo; does not mean the email was ignored.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Clicks are the most reliable</dt>
                <dd>
                  They work whichever email service the person uses. Some company security tools open links
                  automatically to check them, which can look like a click.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">Delivered means it was accepted</dt>
                <dd>
                  The person&apos;s email provider (Gmail, for example) took the email. That doesn&apos;t promise it
                  reached their inbox rather than their spam folder.
                </dd>
              </div>
            </dl>
          </details>
        </section>
      )}

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
