import { forwardRef } from 'react';

type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  /** The accessible name AND the hover tooltip. Required: an icon alone says nothing. */
  label: string;
  /** `lg` (36px) is for touch: the reading pane's toolbar on a phone. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  tone?: 'default' | 'danger' | 'primary' | 'onDark';
  /** Draws the 1px border the reading-pane toolbar uses. */
  outlined?: boolean;
  active?: boolean;
};

const SIZES = { xs: 'h-6 w-6', sm: 'h-7 w-7', md: 'h-[30px] w-[30px]', lg: 'h-9 w-9' };

const TONES = {
  default: 'text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground',
  primary: 'text-primary hover:bg-primary/10',
  danger: 'text-destructive hover:bg-destructive/10',
  onDark: 'text-white/60 hover:bg-white/10 hover:text-white',
};

/**
 * A square icon control. Every icon-only button in the app is one of these,
 * so they all carry a name, the same hit area and the same hover.
 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'sm', tone = 'default', outlined = false, active = false, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        SIZES[size],
        TONES[tone],
        outlined ? (tone === 'danger' ? 'border border-destructive/30' : 'border border-border') : '',
        active ? 'bg-foreground/[0.07] text-foreground' : '',
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
