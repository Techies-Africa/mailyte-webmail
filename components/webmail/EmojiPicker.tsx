'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A small emoji palette for the compose toolbar.
 *
 * Local, static and dependency-free on purpose: a mail client should not
 * fetch a picker library or an emoji index from a CDN to put a smile in a
 * message. Native glyphs render from the OS font, so nothing ships as
 * images either.
 */
const GROUPS: { label: string; emoji: string[] }[] = [
  {
    label: 'Smileys',
    emoji: ['😀', '😄', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅', '😉', '🙂', '😐', '😢', '😭', '😡', '🥳', '🤯', '😴', '🤗', '🙃', '😬', '🤝'],
  },
  {
    label: 'Gestures',
    emoji: ['👍', '👎', '👏', '🙏', '👋', '🙌', '💪', '🤞', '✌️', '👌', '🤙', '☝️', '👇', '👉', '👈', '✋'],
  },
  {
    label: 'Objects',
    emoji: ['✅', '❌', '⭐', '🔥', '💡', '📎', '📌', '📅', '📧', '📞', '💻', '📝', '🔒', '🔑', '⏰', '🚀', '🎉', '🎯', '📈', '📉', '💰', '🧾', '🏆', '☕'],
  },
  {
    label: 'Symbols',
    emoji: ['❤️', '💜', '💙', '💚', '🧡', '💛', '⚠️', '❗', '❓', '➡️', '⬅️', '🔁', '✨', '💯', '🆗', '🆕'],
  },
];

type EmojiPickerProps = {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Opens upward, for a toolbar on the bottom edge of the window. */
  direction?: 'up' | 'down';
};

export default function EmojiPicker({ onPick, onClose, direction = 'up' }: EmojiPickerProps) {
  const [group, setGroup] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji"
      // Anchored to the button's RIGHT edge: the emoji button sits in the
      // right half of the toolbar, so a panel growing rightwards from it
      // would run off the edge of a 560px compose window.
      className={`absolute right-0 z-30 w-[268px] animate-fade-in rounded-xl border border-border bg-popover p-2 shadow-panel ${
        direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
    >
      <div className="mb-1.5 flex gap-1">
        {GROUPS.map((g, i) => (
          <button
            key={g.label}
            type="button"
            onClick={() => setGroup(i)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              group === i ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-0.5">
        {GROUPS[group].emoji.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(emoji)}
            aria-label={emoji}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[17px] leading-none hover:bg-muted"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
