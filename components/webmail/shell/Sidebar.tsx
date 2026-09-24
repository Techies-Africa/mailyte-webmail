'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { ChevronDown, Keyboard, LogOut, Menu as MenuIcon, Moon, Plus, Settings, ShieldCheck, Sun, X } from 'lucide-react';
import { BrandLockup } from '@/components/brand/BrandMark';
import Avatar from '@/components/ui/Avatar';
import IconButton from '@/components/ui/IconButton';

export const SIDEBAR_OPEN_WIDTH = 228;
export const SIDEBAR_COLLAPSED_WIDTH = 58;

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCompose: () => void;
  email: string;
  /** The holder's display name, from settings. */
  name?: string | null;
  /** Absent on screens that have no folder counts (settings, calendar). */
  unreadCount?: number;
  onOpenSettings: () => void;
  onOpenSecurity?: () => void;
  onLogout: () => void;
  onShowShortcuts?: () => void;
  /** The navigation: folders on the mailbox screen, sections on settings. */
  children: React.ReactNode;
  /** On phones the rail is a drawer. */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
};

/**
 * The rail.
 *
 * Dark in both themes: the redesign draws an ink column with the lockup at
 * the top, a filled Compose button, the navigation, and at the bottom the
 * theme switch and a profile chip whose menu holds settings and sign-out.
 * Collapsing keeps the icons and hides every word.
 */
export default function Sidebar({
  collapsed,
  onToggleCollapsed,
  onCompose,
  email,
  name,
  unreadCount,
  onOpenSettings,
  onOpenSecurity,
  onLogout,
  onShowShortcuts,
  children,
  mobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  // Escape closes the account menu, like every other floating panel here.
  // Without it the click-away backdrop stayed up after Escape and swallowed
  // the next click anywhere on the screen.
  useEffect(() => {
    if (!profileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [profileOpen]);

  const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_OPEN_WIDTH;

  return (
    <>
      {/* Phone drawer backdrop. */}
      {mobileOpen && (
        <div aria-hidden onClick={onCloseMobile} className="fixed inset-0 z-30 bg-black/50 md:hidden" />
      )}

      <aside
        aria-label="Navigation"
        style={{ width: mobileOpen ? SIDEBAR_OPEN_WIDTH : width }}
        className={[
          'flex h-full shrink-0 flex-col bg-sidebar pb-3.5 text-sidebar-foreground transition-[width] duration-200',
          // Off-canvas on phones unless opened.
          'fixed inset-y-0 left-0 z-40 md:static md:z-auto',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        <div
          className={`flex shrink-0 items-center px-3 pb-2.5 pt-3.5 ${
            collapsed && !mobileOpen ? 'justify-center' : 'justify-between'
          }`}
        >
          {(!collapsed || mobileOpen) && (
            <a href="/" aria-label="Inbox" className="flex min-w-0 items-center">
              <BrandLockup height={24} tone="dark" />
            </a>
          )}
          {mobileOpen ? (
            <IconButton label="Close menu" tone="onDark" size="md" onClick={onCloseMobile}>
              <X size={15} />
            </IconButton>
          ) : (
            <IconButton
              label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              tone="onDark"
              size="md"
              onClick={onToggleCollapsed}
              className="hidden md:inline-flex"
            >
              <MenuIcon size={15} />
            </IconButton>
          )}
        </div>

        <div className="shrink-0 px-2.5 pb-3">
          <button
            type="button"
            onClick={onCompose}
            title="Compose (c)"
            className={[
              'flex w-full items-center rounded-xl bg-primary text-[13.5px] font-semibold text-primary-foreground shadow-compose transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-compose-hover',
              collapsed && !mobileOpen ? 'justify-center px-0 py-2.5' : 'gap-2 px-3.5 py-2.5',
            ].join(' ')}
          >
            <Plus size={14} strokeWidth={2.6} />
            {(!collapsed || mobileOpen) && <span>Compose</span>}
          </button>
        </div>

        <nav className="sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5">
          {children}
        </nav>

        <div className="relative mx-2.5 mt-2 shrink-0">
          <button
            type="button"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={[
              'mb-1 flex w-full items-center rounded-[9px] py-[7px] text-[12px] font-medium text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/80',
              collapsed && !mobileOpen ? 'justify-center px-0' : 'gap-2 px-2.5',
            ].join(' ')}
          >
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
            {(!collapsed || mobileOpen) && <span>{isDark ? 'Light mode' : 'Dark mode'}</span>}
          </button>

          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            title={email}
            className={[
              'flex w-full items-center rounded-[9px] bg-white/[0.06] text-left transition-colors hover:bg-white/[0.1]',
              collapsed && !mobileOpen ? 'justify-center px-0 py-2' : 'gap-2 px-2.5 py-2',
            ].join(' ')}
          >
            <Avatar name={name ?? email} email={email} size={28} onDark className="!bg-primary !text-primary-foreground" />
            {(!collapsed || mobileOpen) && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-white">{email || '…'}</span>
                  <span className="block truncate text-[10.5px] text-white/45">
                    {unreadCount === undefined ? (name ?? 'Mailbox') : `${unreadCount} unread`}
                  </span>
                </span>
                <ChevronDown size={11} strokeWidth={2.2} className="shrink-0 text-white/50" />
              </>
            )}
          </button>

          {profileOpen && (
            <>
              <div aria-hidden onClick={() => setProfileOpen(false)} className="fixed inset-0 z-40" />
              <div
                role="menu"
                aria-label="Account"
                className={[
                  'absolute bottom-[calc(100%+6px)] z-50 w-60 animate-fade-in overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-panel',
                  collapsed && !mobileOpen ? 'left-0' : 'inset-x-0 w-auto',
                ].join(' ')}
              >
                <div className="border-b border-border px-3.5 py-3">
                  {name && <div className="truncate text-[12.5px] font-bold">{name}</div>}
                  <div className="truncate font-mono text-[11.5px] text-muted-foreground">{email}</div>
                </div>
                <div className="p-1.5">
                  <ProfileMenuItem
                    icon={<Settings size={13} />}
                    label="Settings"
                    onClick={() => {
                      setProfileOpen(false);
                      onOpenSettings();
                    }}
                  />
                  {onOpenSecurity && (
                    <ProfileMenuItem
                      icon={<ShieldCheck size={13} />}
                      label="Security"
                      onClick={() => {
                        setProfileOpen(false);
                        onOpenSecurity();
                      }}
                    />
                  )}
                  {onShowShortcuts && (
                    <ProfileMenuItem
                      icon={<Keyboard size={13} />}
                      label="Keyboard shortcuts"
                      onClick={() => {
                        setProfileOpen(false);
                        onShowShortcuts();
                      }}
                    />
                  )}
                  <ProfileMenuItem
                    icon={<LogOut size={13} />}
                    label="Sign out"
                    danger
                    onClick={() => {
                      setProfileOpen(false);
                      onLogout();
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function ProfileMenuItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] font-semibold ${
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-muted'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
