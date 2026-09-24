'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Tag } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Tag as TagPill } from '@/components/ui/Pill';
import { labelTitle, labelTone } from '@/lib/webmail/tags';

type LabelPickerDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Every label in use in the mailbox. */
  known: string[];
  /** The labels each selected message currently carries. */
  current: string[][];
  /** "3 messages" or a subject. */
  what: string;
  onApply: (add: string[], remove: string[]) => void;
};

/** How many labels one message may carry -- Maildir's per-folder keyword ceiling. */
const MAX_PER_MESSAGE = 26;

function slugOf(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '').replace(/_{2,}/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 40);
}

/**
 * Tick labels on and off for one message or several.
 *
 * Three states per label when several messages are selected: on all of
 * them, on some, on none. Leaving a "some" label alone changes nothing; a
 * click makes it "all", another makes it "none" -- the same rule Gmail's
 * label menu follows. A new label is typed in and applies to every selected
 * message.
 */
export default function LabelPickerDialog({ isOpen, onClose, known, current, what, onApply }: LabelPickerDialogProps) {
  // The initial state per label: 'all' | 'some' | 'none'.
  const initial = useMemo(() => {
    const map = new Map<string, 'all' | 'some' | 'none'>();
    const names = new Set<string>([...known, ...current.flat()]);
    for (const name of names) {
      const count = current.filter((labels) => labels.includes(name)).length;
      map.set(name, count === 0 ? 'none' : count === current.length ? 'all' : 'some');
    }
    return map;
  }, [known, current]);

  const [state, setState] = useState<Map<string, 'all' | 'some' | 'none'>>(initial);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Seeded as the dialog OPENS, and only then. `current` is rebuilt on every
  // parent render, and a background refresh re-renders the parent -- re-seeding
  // on each one would undo the ticks the person is in the middle of making.
  const initialRef = useRef(initial);
  useEffect(() => {
    initialRef.current = initial;
  }, [initial]);
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(new Map(initialRef.current));
      setDraft('');
      setError(null);
    }
  }, [isOpen]);

  const names = useMemo(() => [...state.keys()].sort(), [state]);

  const toggle = (name: string) => {
    setState((prev) => {
      const next = new Map(prev);
      const now = prev.get(name) ?? 'none';
      next.set(name, now === 'all' ? 'none' : 'all');
      return next;
    });
  };

  const addNew = () => {
    const slug = slugOf(draft);
    if (!slug) {
      setError('A label needs at least one letter or digit.');
      return;
    }
    setError(null);
    setDraft('');
    setState((prev) => {
      const next = new Map(prev);
      next.set(slug, 'all');
      return next;
    });
  };

  const apply = () => {
    const add: string[] = [];
    const remove: string[] = [];
    for (const [name, now] of state) {
      const was = initial.get(name) ?? 'none';
      if (now === was) continue;
      if (now === 'all') add.push(name);
      else if (now === 'none' && was !== 'none') remove.push(name);
    }
    const perMessage = Math.max(0, ...current.map((labels) => new Set([...labels, ...add]).size));
    if (perMessage > MAX_PER_MESSAGE) {
      setError(`A message can carry at most ${MAX_PER_MESSAGE} labels.`);
      return;
    }
    onApply(add, remove);
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Labels"
      icon={<Tag size={16} />}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <p className="mb-3 truncate text-sm text-muted-foreground">{what}</p>

      {names.length === 0 ? (
        <p className="mb-3 rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          No labels yet. Make one below.
        </p>
      ) : (
        <ul className="thin-scroll mb-3 max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
          {names.map((name) => {
            const now = state.get(name) ?? 'none';
            return (
              <li key={name}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={now === 'all'}
                    ref={(el) => {
                      if (el) el.indeterminate = now === 'some';
                    }}
                    onChange={() => toggle(name)}
                    className="h-4 w-4 accent-primary"
                  />
                  <TagPill tone={labelTone(name)}>{labelTitle(name)}</TagPill>
                  {now === 'some' && <span className="ml-auto text-[11px] text-muted-foreground">on some</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addNew();
            }
          }}
          placeholder="New label"
          aria-label="New label"
          autoComplete="off"
          maxLength={40}
        />
        <Button icon={<Plus size={13} />} onClick={addNew} disabled={draft.trim() === ''}>
          Add
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Labels live on the message itself, so your phone and desktop mail apps see them too.
      </p>
    </Dialog>
  );
}
