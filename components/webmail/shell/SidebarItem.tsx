'use client';

import Link from 'next/link';

type SidebarItemProps = {
  icon?: React.ReactNode;
  /** A coloured dot in place of an icon (the category rows). */
  dot?: string;
  label: string;
  badge?: number | string;
  badgeTone?: 'primary' | 'muted';
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
  /**
   * Rendered at the right on hover (the folder menu). Sits BESIDE the row's
   * button, never inside it: a button inside a button is invalid HTML and
   * React refuses to hydrate it.
   */
  trailing?: React.ReactNode;
  indent?: boolean;
  /** For a folder row: the address or full path, shown on hover. */
  title?: string;
  as?: 'button' | 'a';
  href?: string;
};

/**
 * One row in the rail. Ink ground, 68% white text, brighter on hover, and a
 * filled pill when active -- exactly the `.fBtn` the redesign draws. Collapsed,
 * it is the icon alone and the label moves to the tooltip.
 */
export default function SidebarItem({
  icon,
  dot,
  label,
  badge,
  badgeTone = 'primary',
  active = false,
  collapsed = false,
  onClick,
  trailing,
  indent = false,
  title,
  as = 'button',
  href,
}: SidebarItemProps) {
  const showBadge = badge !== undefined && badge !== 0 && badge !== '';
  const hasTrailing = Boolean(trailing) && !collapsed;

  const className = [
    'group relative flex w-full min-w-0 items-center gap-2 rounded-[9px] text-left text-[12.5px] font-medium transition-colors',
    collapsed ? 'justify-center px-0 py-[7px]' : 'px-2.5 py-[7px]',
    indent && !collapsed ? 'pl-4' : '',
    hasTrailing ? 'pr-8' : '',
    active ? 'bg-white/[0.12] font-semibold text-white' : 'text-white/[0.68] hover:bg-white/[0.08] hover:text-white',
  ].join(' ');

  const content = (
    <>
      {dot ? (
        <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: dot }} />
      ) : (
        <span aria-hidden className="flex h-[14px] w-[14px] shrink-0 items-center justify-center [&>svg]:h-[14px] [&>svg]:w-[14px]">
          {icon}
        </span>
      )}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {showBadge && (
        <span
          className={[
            'shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold leading-4',
            badgeTone === 'primary' ? 'bg-primary text-primary-foreground' : 'bg-white/[0.15] text-white',
            collapsed ? 'absolute -right-0.5 -top-0.5 min-w-[16px] text-center' : '',
          ].join(' ')}
        >
          {badge}
        </span>
      )}
    </>
  );

  // A client-side navigation, not a page load: the app's cache survives the
  // trip between mail, calendar, contacts and settings.
  const row =
    as === 'a' && href ? (
      <Link href={href} title={collapsed ? label : title} aria-current={active ? 'page' : undefined} className={className}>
        {content}
      </Link>
    ) : (
      <button type="button" onClick={onClick} title={collapsed ? label : title} aria-current={active ? 'page' : undefined} className={className}>
        {content}
      </button>
    );

  if (!hasTrailing) return row;

  return (
    <div className="group/row relative">
      {row}
      {/* Revealed on hover with a mouse; always there on touch, where a
          hover never comes and folder rename and delete had no way in. */}
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 transition-opacity can-hover:opacity-0 can-hover:focus-within:opacity-100 can-hover:group-hover/row:opacity-100">
        {trailing}
      </span>
    </div>
  );
}

export function SidebarEyebrow({ children, collapsed }: { children: React.ReactNode; collapsed?: boolean }) {
  if (collapsed) return <div className="mx-auto my-2 h-px w-6 bg-white/[0.08]" />;
  return (
    <div className="px-2.5 pb-1 pt-3 font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-white/30">
      {children}
    </div>
  );
}

export function SidebarDivider() {
  return <div className="my-2 h-px bg-white/[0.08]" />;
}
