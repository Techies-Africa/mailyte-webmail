import { forwardRef } from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dashed' | 'onDark';
  size?: 'xs' | 'sm' | 'md';
  /** A spinner replaces the icon and the button stops accepting clicks. */
  busy?: boolean;
  icon?: React.ReactNode;
};

const SIZES = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-md',
  md: 'h-9 px-4 text-[13px] gap-2 rounded-lg',
};

const VARIANTS = {
  primary:
    'bg-primary text-primary-foreground font-semibold hover:brightness-95 active:brightness-90',
  secondary:
    'border border-border bg-card text-foreground font-semibold hover:bg-muted',
  ghost: 'text-muted-foreground font-semibold hover:bg-foreground/[0.07] hover:text-foreground',
  danger:
    'border border-destructive/30 bg-card text-destructive font-semibold hover:bg-destructive/10',
  dashed:
    'border-[1.5px] border-dashed border-border bg-transparent text-muted-foreground font-semibold hover:border-foreground/40 hover:text-foreground',
  onDark: 'bg-white/10 text-white font-semibold hover:bg-white/20',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', busy = false, icon, className, children, type = 'button', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      className={[
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[filter,background-color,color] disabled:cursor-not-allowed disabled:opacity-50',
        SIZES[size],
        VARIANTS[variant],
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {busy ? (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});

export default Button;
