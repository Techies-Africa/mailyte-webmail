type PillProps = {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
};

/** A filter pill. Active is a solid primary; idle is text only. */
export function FilterPill({ active = false, onClick, children, title, className }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

type TagProps = {
  tone?: 'neutral' | 'primary' | 'warning' | 'danger' | 'success';
  children: React.ReactNode;
  className?: string;
};

const TAG_TONES = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  warning: 'bg-warning/[0.14] text-warning',
  danger: 'bg-destructive/[0.12] text-destructive',
  success: 'bg-success/[0.12] text-success',
};

/** The small uppercase tag under a message row. */
export function Tag({ tone = 'neutral', children, className }: TagProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.03em]',
        TAG_TONES[tone],
        className ?? '',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

/** A status pill in the guide's "active" style: soft tint, 999px radius. */
export function StatusBadge({ tone = 'primary', children, className }: TagProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        TAG_TONES[tone],
        className ?? '',
      ].join(' ')}
    >
      {children}
    </span>
  );
}
