import { forwardRef } from 'react';

/**
 * Form controls in the guide's shape: 8px radius, zinc border, indigo focus
 * ring with a faint indigo wash. One class string, used everywhere a
 * settings form or a dialog takes input.
 */
export const fieldClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:bg-primary/[0.04] focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={`${fieldClass} ${className ?? ''}`} {...rest} />;
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={`${fieldClass} ${className ?? ''}`} {...rest} />;
});

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...rest },
  ref,
) {
  return <select ref={ref} className={`${fieldClass} ${className ?? ''}`} {...rest} />;
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
