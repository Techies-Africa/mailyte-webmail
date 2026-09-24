'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { ACCENTS, DEFAULT_ACCENT, applyAccent, readAccent, storeAccent, type AccentId } from '@/lib/webmail/accent';
import { Hint } from '@/components/ui/Field';
import type { SettingsSectionProps } from './types';

/**
 * Appearance: theme and the accent colour.
 *
 * The only section that saves nothing to the server. Both are per-device
 * preferences, so it never calls onDirty or onSaved.
 */
export default function AppearanceSettings(_props: SettingsSectionProps) {
  const [accent, setAccent] = useState<AccentId>(DEFAULT_ACCENT);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccent(readAccent());
    setMounted(true);
  }, []);

  const choose = (id: AccentId) => {
    setAccent(id);
    applyAccent(id);
    storeAccent(id);
  };

  const themes = [
    { id: 'light', label: 'Light', icon: <Sun size={15} /> },
    { id: 'dark', label: 'Dark', icon: <Moon size={15} /> },
    { id: 'system', label: 'Follow the system', icon: <Monitor size={15} /> },
  ];

  return (
    <div className="space-y-8">
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
