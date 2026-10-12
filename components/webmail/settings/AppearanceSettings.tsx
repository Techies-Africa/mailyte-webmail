'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { ACCENTS, DEFAULT_ACCENT, applyAccent, readAccent, storeAccent, type AccentId } from '@/lib/webmail/accent';
import {
  DEFAULT_FONT,
  DEFAULT_SCALE,
  FONTS,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  applyFont,
  applyScale,
  readFont,
  readScale,
  storeFont,
  storeScale,
  type FontId,
} from '@/lib/webmail/typography';
import { Hint } from '@/components/ui/Field';
import type { SettingsSectionProps } from './types';

/**
 * Appearance: text size, font, theme and the accent colour.
 *
 * The only section that saves nothing to the server. All four are per-device
 * preferences, so it never calls onDirty or onSaved.
 */
export default function AppearanceSettings(_props: SettingsSectionProps) {
  const [accent, setAccent] = useState<AccentId>(DEFAULT_ACCENT);
  const [font, setFont] = useState<FontId | null>(DEFAULT_FONT);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setAccent(readAccent());
    setFont(readFont());
    setScale(readScale());
    /* eslint-enable react-hooks/set-state-in-effect */
    setMounted(true);
  }, []);

  const choose = (id: AccentId) => {
    setAccent(id);
    applyAccent(id);
    storeAccent(id);
  };

  const chooseFont = (id: FontId | null) => {
    setFont(id);
    applyFont(id);
    storeFont(id);
  };

  const chooseScale = (percent: number) => {
    setScale(percent);
    applyScale(percent);
    storeScale(percent);
  };

  const themes = [
    { id: 'light', label: 'Light', icon: <Sun size={15} /> },
    { id: 'dark', label: 'Dark', icon: <Moon size={15} /> },
    { id: 'system', label: 'Follow the system', icon: <Monitor size={15} /> },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-display text-[14px] font-semibold">Text size</h3>
        <p className="mb-3 mt-1 max-w-2xl text-[13px] text-muted-foreground">
          Scales every piece of text — the message list, the mail you are reading, and this page. It applies straight
          away.
        </p>
        <div className="flex max-w-md items-center gap-3">
          <span aria-hidden className="shrink-0 text-[11px] text-muted-foreground">
            A
          </span>
          <input
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={scale}
            onChange={(event) => chooseScale(Number(event.target.value))}
            aria-label="Text size"
            aria-valuetext={`${scale} percent`}
            className="h-1.5 w-full cursor-pointer accent-primary"
          />
          <span aria-hidden className="shrink-0 text-[19px] leading-none text-muted-foreground">
            A
          </span>
          <output className="w-11 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
            {scale}%
          </output>
        </div>
        {mounted && scale !== DEFAULT_SCALE && (
          <button
            type="button"
            onClick={() => chooseScale(DEFAULT_SCALE)}
            className="mt-2 text-[12.5px] font-semibold text-primary hover:underline"
          >
            Reset to {DEFAULT_SCALE}%
          </button>
        )}
      </section>

      <section>
        <h3 className="font-display text-[14px] font-semibold">Font</h3>
        <p className="mb-3 mt-1 max-w-2xl text-[13px] text-muted-foreground">
          Used across the whole mailbox, headings and subject lines included. Each name below is shown in its own font.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FONTS.map((f) => {
            const isOn = mounted && font === f.id;
            return (
              <button
                key={f.id ?? 'default'}
                type="button"
                onClick={() => chooseFont(f.id)}
                aria-pressed={isOn}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                  isOn ? 'border-primary bg-primary/[0.06]' : 'border-border hover:border-foreground/30'
                }`}
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[15px] font-semibold"
                  // Previewing the family is also what downloads it -- on this
                  // page only, and with display: swap, so nothing blocks.
                  style={{ fontFamily: f.preview }}
                >
                  {isOn ? <Check size={16} strokeWidth={3} className="text-primary" /> : 'Aa'}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold" style={{ fontFamily: f.preview }}>
                      {f.name}
                    </span>
                    {f.id === DEFAULT_FONT && (
                      <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
                        Default
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{f.note}</span>
                </span>
              </button>
            );
          })}
        </div>

        <Hint>
          Stored in this browser only — nobody else sees it, and it does not follow you to another device. Inside a
          message the nearest font your device already has is used, because a downloaded font cannot reach into the
          frame a message is drawn in; and mail that ships its own font keeps it.
        </Hint>
      </section>

      <section>
        <h3 className="font-display text-[14px] font-semibold">Theme</h3>
        <p className="mb-3 mt-1 text-[13px] text-muted-foreground">The sidebar stays dark in both.</p>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {themes.map((option) => {
            const isOn = mounted && (theme ?? 'system') === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isOn}
                onClick={() => setTheme(option.id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  isOn ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.icon}
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="font-display text-[14px] font-semibold">Accent colour</h3>
        <p className="mb-3 mt-1 max-w-2xl text-[13px] text-muted-foreground">
          Sets the colour of buttons, links, the Compose button and focus rings. It applies straight away.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ACCENTS.map((a) => {
            const isOn = mounted && accent === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => choose(a.id)}
                aria-pressed={isOn}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                  isOn ? 'border-primary bg-primary/[0.06]' : 'border-border hover:border-foreground/30'
                }`}
              >
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: a.swatch }}>
                  {isOn && <Check size={16} strokeWidth={3} className="text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">{a.name}</span>
                    {a.id === DEFAULT_ACCENT && (
                      <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
                        Default
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{a.note}</span>
                </span>
              </button>
            );
          })}
        </div>

        <Hint>
          Stored in this browser only — nobody else sees it, and it does not follow you to another device. Each colour
          carries a light and a dark value so the button label stays legible in both.
        </Hint>
      </section>
    </div>
  );
}
