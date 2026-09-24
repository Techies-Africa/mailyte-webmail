'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { getVacation, updateVacation } from '@/lib/webmail/client';
import Button from '@/components/ui/Button';
import { Hint, Input, Label, Switch, Textarea } from '@/components/ui/Field';
import type { SettingsSectionProps } from './types';

/**
 * The vacation auto-responder (Sieve `vacation`).
 *
 * Only the fields the mail server actually honours are here. It sends at
 * most one reply per sender per day, which is stated rather than made
 * configurable: the interval exists to stop a loop with another responder.
 */
export default function VacationSettings({ onUnauthorized, onDirty, onSaved }: SettingsSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [subject, setSubject] = useState('Out of Office');
  const [message, setMessage] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getVacation(onUnauthorized).then((result) => {
      // Restore ALL of it: the mail server stores every field on the Sieve
      // script and returns them from parse_vacation.
      if (result.success && result.data) {
        setEnabled(result.data.enabled);
        setSubject(result.data.subject || 'Out of Office');
        setMessage(result.data.message ?? '');
        setStartDate(result.data.start_date ?? '');
        setEndDate(result.data.end_date ?? '');
      } else if (!result.success) {
        setError(result.message);
      }
      setLoading(false);
    });
  }, [onUnauthorized]);

  const touch = () => {
    setSaved(false);
    onDirty?.();
  };

  const save = async () => {
    setError(null);
    if (enabled && message.trim() === '') {
      setError('Write the reply people will receive, or turn the responder off.');
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      setError('The end date is before the start date.');
      return;
    }
    setSaving(true);
    const result = await updateVacation(
      {
        enabled,
        subject: subject.trim() || 'Out of Office',
        message,
        start_date: startDate || null,
        end_date: endDate || null,
      },
      onUnauthorized,
    );
    setSaving(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    onSaved?.();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading vacation settings…</p>;

  return (
    <div className="space-y-6" data-shortcuts="off">
      <Switch
        checked={enabled}
        onChange={(next) => {
          setEnabled(next);
          touch();
        }}
        label="Send an automatic reply"
      />

      <div className={`max-w-lg space-y-4 ${enabled ? '' : 'pointer-events-none opacity-50'}`}>
        <div>
          <Label htmlFor="vac-subject">Subject</Label>
          <Input
            id="vac-subject"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              touch();
            }}
          />
        </div>

        <div>
          <Label htmlFor="vac-message">Reply</Label>
          <Textarea
            id="vac-message"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              touch();
            }}
            rows={5}
            placeholder="I'm away until the 30th and will reply when I'm back."
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="vac-start">Start (optional)</Label>
            <Input
              id="vac-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                touch();
              }}
            />
          </div>
          <div>
            <Label htmlFor="vac-end">End (optional)</Label>
            <Input
              id="vac-end"
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                touch();
              }}
            />
          </div>
        </div>

        <Hint>Each sender receives at most one reply per day, so a conversation with another autoresponder cannot loop.</Hint>
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
