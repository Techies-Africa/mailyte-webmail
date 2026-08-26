import { useEffect, useState } from 'react';
import { getVacation, updateVacation } from '@/lib/webmail/client';
import type { SettingsSectionProps } from './types';

/**
 * The vacation auto-responder (Sieve `vacation`).
 *
 * Only the fields the mail server actually honours are here. It sends at
 * most one reply per sender per day, which is stated rather than made
 * configurable: the interval exists to stop a reply loop with another
 * autoresponder, and it is not a preference worth the extra control.
 */
export default function VacationSettings({
  onUnauthorized,
  onDirty,
  onSaved,
}: SettingsSectionProps) {
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
      if (result.success) setEnabled(result.data.enabled);
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

  if (loading) return <p className="text-sm text-gray-500">Loading vacation settings…</p>;

  return (
    <div className="space-y-4" data-shortcuts="off">
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
          Send an automatic reply
        </span>
      </label>

      <div className={`space-y-3 ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor="vac-subject">
            Subject
          </label>
          <input
            id="vac-subject"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              touch();
            }}
            className="w-full text-sm px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-transparent"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1" htmlFor="vac-message">
            Reply
          </label>
          <textarea
            id="vac-message"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              touch();
            }}
            rows={5}
            placeholder="I'm away until the 30th and will reply when I'm back."
            className="w-full text-sm px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-transparent"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1" htmlFor="vac-start">
              Start (optional)
            </label>
            <input
              id="vac-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                touch();
              }}
              className="text-sm px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-transparent"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1" htmlFor="vac-end">
              End (optional)
            </label>
            <input
              id="vac-end"
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                touch();
              }}
              className="text-sm px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-transparent"
            />
          </div>
        </div>

        <p className="text-xs text-gray-500">
          Each sender receives at most one reply per day, so a conversation with another
          autoresponder cannot loop.
        </p>
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
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
      </div>
    </div>
  );
}
