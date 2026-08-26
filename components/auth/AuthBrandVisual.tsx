'use client';

import { motion } from 'framer-motion';

// Base bar heights (%) for the looping "email volume" chart.
const bars = [38, 60, 48, 72, 90, 66, 84, 55, 70, 62];

const stats = [
  { label: 'Delivered', value: '98.7%' },
  { label: 'Opened', value: '42.3%' },
  { label: 'Clicked', value: '21.5%' },
];

/**
 * Decorative, continuously-animating "live deliverability" panel for the auth
 * brand side. Pure CSS + framer-motion — fills the space with motion and evokes
 * the real product dashboard. Figures are illustrative. Stretches to fill its
 * container (the bar chart grows to take remaining height).
 */
export default function AuthBrandVisual({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border border-border bg-background/70 p-6 shadow-sm backdrop-blur-sm md:p-7 ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">
          Email volume
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <motion.span
            className="h-2.5 w-2.5 rounded-full bg-green-500"
            animate={{ opacity: [1, 0.3, 1], scale: [1, 0.85, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          Live
        </span>
      </div>

      {/* Animated bar chart */}
      <div className="mt-6 flex h-64 items-end gap-2">
        {bars.map((h, i) => (
          <motion.div
            key={i}
            className="flex-1 rounded-t-md bg-gradient-to-t from-primary/30 to-primary"
            initial={{ height: `${h}%` }}
            animate={{
              height: [`${h}%`, `${Math.min(100, h + 14)}%`, `${Math.max(18, h - 12)}%`, `${h}%`],
            }}
            transition={{
              duration: 4.5,
              repeat: Infinity,
              delay: i * 0.12,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>

      {/* Stat row */}
      <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-5">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
              {s.value}
            </div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
