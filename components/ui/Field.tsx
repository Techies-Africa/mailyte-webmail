import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Form controls in the guide's shape: 8px radius, zinc border, indigo focus
 * ring with a faint indigo wash. One class string, used everywhere a
 * settings form or a dialog takes input.
 */
export const fieldClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:bg-primary/[0.04] focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The same control as a soft grey well with no border until it has focus:
 * the event dialog's look, where a border round every field turned the form
 * into a grid of boxes. Same size and radius as fieldClass.
 */
export const filledFieldClass =
  'w-full rounded-lg border border-transparent bg-muted/70 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60';

/** `outline` everywhere a form takes input; `filled` in the event dialog. */
export type FieldVariant = 'outline' | 'filled';

const FIELD_VARIANTS: Record<FieldVariant, string> = { outline: fieldClass, filled: filledFieldClass };

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { variant?: FieldVariant };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, variant = 'outline', ...rest },
  ref,
) {
  return <input ref={ref} className={`${FIELD_VARIANTS[variant]} ${className ?? ''}`} {...rest} />;
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { variant?: FieldVariant };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, variant = 'outline', ...rest },
  ref,
) {
  return <textarea ref={ref} className={`${FIELD_VARIANTS[variant]} ${className ?? ''}`} {...rest} />;
});

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  /** 'md' matches Input (38px); 'sm' (32px) is for a select inside a sentence or a toolbar. */
  size?: 'sm' | 'md';
  variant?: FieldVariant;
};

const SELECT_SIZES = {
  md: 'py-2 pl-3 pr-9 text-sm',
  sm: 'py-1.5 pl-2.5 pr-8 text-[12.5px] leading-[18px]',
};

/** Each variant's box and focus ring (focus-visible: see below). */
const SELECT_VARIANTS: Record<FieldVariant, string> = {
  outline:
    'border-input bg-background focus-visible:border-primary focus-visible:bg-primary/[0.04] focus-visible:ring-2 focus-visible:ring-primary/25',
  filled:
    'border-transparent bg-muted/70 focus-visible:border-primary focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/20',
};

/**
 * A native select in the field look, with its own chevron.
 *
 * `className` sizes a wrapper, not the select. Tailwind emits utilities of
 * one group in its own order, not the order of the class list, so a caller's
 * `w-28` or `py-1` on top of fieldClass's `w-full` and `py-2` never applied:
 * the contact type selects were half the row, and the header pickers were
 * 14px text clipped in a 32px box. Width and layout go on the wrapper
 * (`block` fills a form column; in a flex row give it a width or flex-1), and
 * the box itself comes from `size`.
 *
 * The ring is focus-visible, not focus: a native select keeps focus after its
 * popup closes, and `focus:` kept the ring on after every mouse pick. How far
 * that helps depends on the browser -- Chromium counts a select as taking
 * typing and matches :focus-visible even after a click, so there the ring
 * still shows while it has focus, as a text input's does. (The header
 * pickers that looked broken are SelectMenu buttons now, which never ring
 * after a click.) Text inputs keep `focus:`: typing is the point.
 * appearance-none drops the browser's own arrow, which ignored the theme and
 * sat in a different place in every browser.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, size = 'md', variant = 'outline', ...rest },
  ref,
) {
  return (
    // A span, so the wrapper is valid inside a <label> or a <p>.
    <span className={['relative block', className ?? ''].join(' ')}>
      <select
        ref={ref}
        {...rest}
        className={[
          'peer block w-full cursor-pointer appearance-none rounded-lg border text-foreground outline-none transition-colors',
          SELECT_VARIANTS[variant],
          'disabled:cursor-not-allowed disabled:opacity-50',
          SELECT_SIZES[size],
        ].join(' ')}
      />
      <ChevronDown
        aria-hidden
        size={size === 'sm' ? 13 : 14}
        strokeWidth={2.2}
        className={[
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50',
          size === 'sm' ? 'right-2.5' : 'right-3',
        ].join(' ')}
      />
    </span>
  );
});

export function Label({
  children,
  htmlFor,
  className,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={`mb-1.5 block text-[13px] font-semibold text-foreground ${className ?? ''}`}>
      {children}
    </label>
  );
}

export function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`mt-1.5 text-xs leading-relaxed text-muted-foreground ${className ?? ''}`}>{children}</p>;
}

/** The mono uppercase eyebrow from the guide: 10-11px, 0.13em tracking. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

export function Checkbox({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary ${className ?? ''}`}
      {...rest}
    />
  );
}

/** A switch. A checkbox underneath, so it keeps keyboard and form semantics. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="absolute inset-0 rounded-full bg-muted-foreground/35 transition-colors peer-checked:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring" />
        <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}
