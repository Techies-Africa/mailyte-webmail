import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  ACCENTS,
  DEFAULT_ACCENT,
  applyAccent,
  readAccent,
  storeAccent,
  type AccentId,
} from '@/lib/webmail/accent';
import type { SettingsSectionProps } from './types';

/**
 * Appearance — the viewer's accent colour.
 *
 * The only section that saves nothing to the server: this is a per-device
 * preference kept in localStorage, so it deliberately never calls onDirty or
 * onSaved. Light/dark stays where it has always been, on the header toggle,
 * because that is reached far more often than a settings page.
 */
export default function AppearanceSettings(_props: SettingsSectionProps) {
  const [accent, setAccent] = useState<AccentId>(DEFAULT_ACCENT);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setAccent(readAccent());
    setMounted(true);
  }, []);

  const choose = (id: AccentId) => {
    setAccent(id);
    applyAccent(id);
    storeAccent(id);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Accent colour</h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
          Sets the colour of buttons, links, the Compose button and focus rings. It applies straight
          away.
        </p>
      </div>

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
                isOn
                  ? 'border-primary bg-primary/5 dark:bg-primary/10'
                  : 'border-border hover:border-foreground/30'
              }`}
            >
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: a.swatch }}
              >
                {isOn && <Check size={16} strokeWidth={3} className="text-white" />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {a.name}
                  </span>
                  {a.id === DEFAULT_ACCENT && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      Default
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                  {a.note}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        Stored in this browser only — nobody else sees it, and it does not follow you to another
        device. Each colour carries a light and a dark value so the button label stays legible in
        both.
      </p>
    </div>
  );
}
