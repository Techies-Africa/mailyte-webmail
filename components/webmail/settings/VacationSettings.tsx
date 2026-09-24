'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { updateVacation } from '@/lib/webmail/client';
import { settingsKeys, useSeed, useVacation } from '@/lib/webmail/query/settingsQueries';
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setError] = useState<string | null>(null);

  // Cached: a second visit opens with the saved responder already filled in.
  const queryClient = useQueryClient();
  const vacation = useVacation(onUnauthorized);
  const [touched, setTouched] = useState(false);
  const seeded = useSeed(vacation, (data) => {
    // Restore ALL of it: the mail server stores every field on the Sieve
    // script and returns them from parse_vacation.
    setEnabled(data.enabled);
    setSubject(data.subject || 'Out of Office');
    setMessage(data.message ?? '');
    setStartDate(data.start_date ?? '');
    setEndDate(data.end_date ?? '');
  }, touched);
  const loading = !seeded && !vacation.isError;
  const error = actionError ?? (!seeded && vacation.isError ? vacation.error.message : null);

  const touch = () => {
    setTouched(true);
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
    const payload = {
      enabled,
      subject: subject.trim() || 'Out of Office',
      message,
      start_date: startDate || null,
      end_date: endDate || null,
    };
    const result = await updateVacation(payload, onUnauthorized);
    setSaving(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setTouched(false);
    // What was saved is what the server now holds; the next visit opens with it.
    queryClient.setQueryData(settingsKeys.vacation, (prev: object | undefined) => ({ ...prev, ...payload, managed: true }));
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

        {/* Stacked on a phone: side by side, each date field was too narrow to read. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
