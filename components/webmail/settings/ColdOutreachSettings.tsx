'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { updateColdOutreach } from '@/lib/webmail/client';
import { settingsKeys, useColdOutreach, useSeed } from '@/lib/webmail/query/settingsQueries';
import Button from '@/components/ui/Button';
import { Hint, Switch } from '@/components/ui/Field';
import type { SettingsSectionProps } from './types';

/**
 * Cold outreach (off unless turned on): first emails from brand-new domains go
 * to their own folder instead of the inbox.
 *
 * Cold-email tools send from throwaway domains bought weeks earlier, so the
 * mail server labels a person-to-person email cold when the sending domain is
 * under a year old and this mailbox has never written to it. The label moves
 * nothing unless this switch is on. Nothing is blocked or deleted: the folder
 * is under Categories, and replying to a sender makes their next email arrive
 * in the inbox.
 */
export default function ColdOutreachSettings({ onUnauthorized, onDirty, onSaved }: SettingsSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const cold = useColdOutreach(onUnauthorized);
  const [touched, setTouched] = useState(false);
  const seeded = useSeed(cold, (data) => setEnabled(data.enabled), touched);
  const loading = !seeded && !cold.isError;
  const error = actionError ?? (!seeded && cold.isError ? cold.error.message : null);

  const save = async () => {
    setError(null);
    setSaving(true);
    const result = await updateColdOutreach(enabled, onUnauthorized);
    setSaving(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setTouched(false);
    queryClient.setQueryData(settingsKeys.coldOutreach, { enabled });
    onSaved?.();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading cold outreach settings…</p>;

  return (
    <div className="space-y-6" data-shortcuts="off">
      <Switch
        checked={enabled}
        onChange={(next) => {
          setEnabled(next);
          setTouched(true);
          setSaved(false);
          onDirty?.();
        }}
        label="Move cold outreach out of my inbox"
      />

      <div className="max-w-lg space-y-2 text-sm text-muted-foreground">
        <p>
          Sales emails from people you have never written to, sent from a domain that is less than a year old, go to
          the <span className="font-medium text-foreground">Cold outreach</span> folder under Categories instead of
          your inbox.
        </p>
        <Hint>
          Nothing is blocked or deleted. Reply to a sender and their next email arrives in your inbox. Newsletters,
          receipts, orders and sign-in codes are not treated as cold outreach, and your own rules always come first.
        </Hint>
      </div>

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
