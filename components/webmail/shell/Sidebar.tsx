'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ChevronDown,
  Keyboard,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  UserPlus,
  X,
} from 'lucide-react';
import { BrandLockup } from '@/components/brand/BrandMark';
import Avatar from '@/components/ui/Avatar';
import IconButton from '@/components/ui/IconButton';
import { useToast } from '@/components/ui/Toast';
import { listAccounts, signOut, switchAccount, type AccountSummary } from '@/lib/webmail/client';

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
 * Dark in both themes: an ink column with the lockup at the top, a filled
 * Compose button, the navigation, and at the bottom the theme switch and a
 * profile chip. The chip's menu is also the account switcher: every mailbox
 * signed in on this browser is listed, one click moves between them, and
 * sign-out is per mailbox or for all of them.
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
  onShowShortcuts,
  children,
  mobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [profileOpen, setProfileOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  // Who else is signed in here. Loaded once; the list only changes through
  // this menu or the login page, both of which reload the document.
  useEffect(() => {
    void listAccounts().then((result) => {
      if (result.success && Array.isArray(result.data?.accounts)) setAccounts(result.data.accounts);
    });
  }, []);

  // Escape closes the account menu, like every other floating panel here.
  useEffect(() => {
    if (!profileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [profileOpen]);

  const others = accounts.filter((a) => !a.active && a.email !== email.toLowerCase());

  const switchTo = async (target: string) => {
    setBusy(true);
    const error = await switchAccount(target);
    if (error) {
      setBusy(false);
      toast(error, { tone: 'error' });
    }
  };

  const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_OPEN_WIDTH;
  const rail = collapsed && !mobileOpen;

  return (
    <>
      {mobileOpen && (
        <div aria-hidden onClick={onCloseMobile} className="fixed inset-0 z-30 bg-black/50 md:hidden" />
      )}

      <aside
        aria-label="Navigation"
        style={{ width: mobileOpen ? SIDEBAR_OPEN_WIDTH : width }}
        className={[
          'flex h-full shrink-0 flex-col bg-sidebar pb-3.5 text-sidebar-foreground transition-[width] duration-200',
          'fixed inset-y-0 left-0 z-40 md:static md:z-auto',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        <div className={`flex shrink-0 items-center px-3 pb-2.5 pt-3.5 ${rail ? 'justify-center' : 'justify-between'}`}>
          {!rail && (
            <Link href="/" aria-label="Inbox" className="flex min-w-0 items-center">
              <BrandLockup height={24} tone="dark" />
            </Link>
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
              rail ? 'justify-center px-0 py-2.5' : 'gap-2 px-3.5 py-2.5',
            ].join(' ')}
          >
            <Plus size={14} strokeWidth={2.6} />
            {!rail && <span>Compose</span>}
          </button>
        </div>

        <nav className="sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5">{children}</nav>

        <div className="relative mx-2.5 mt-2 shrink-0">
          <button
            type="button"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={[
              'mb-1 flex w-full items-center rounded-[9px] py-[7px] text-[12px] font-medium text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/80',
              rail ? 'justify-center px-0' : 'gap-2 px-2.5',
            ].join(' ')}
          >
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
            {!rail && <span>{isDark ? 'Light mode' : 'Dark mode'}</span>}
          </button>

          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            title={email}
            className={[
              'flex w-full items-center rounded-[9px] bg-white/[0.06] text-left transition-colors hover:bg-white/[0.1]',
              rail ? 'justify-center px-0 py-2' : 'gap-2 px-2.5 py-2',
            ].join(' ')}
          >
            <span className="relative">
              <Avatar name={name ?? email} email={email} size={28} onDark className="!bg-primary !text-primary-foreground" />
              {others.length > 0 && (
                <span
                  aria-hidden
                  className="absolute -bottom-0.5 -right-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-sidebar px-0.5 text-[9px] font-bold text-white/80 ring-1 ring-white/20"
                >
                  +{others.length}
                </span>
              )}
            </span>
            {!rail && (
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
                  'absolute bottom-[calc(100%+6px)] z-50 w-64 animate-fade-in overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-panel',
                  rail ? 'left-0' : 'inset-x-0 w-auto',
                ].join(' ')}
              >
                <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
                  <Avatar name={name ?? email} email={email} size={30} />
                  <span className="min-w-0">
                    {name && <span className="block truncate text-[12.5px] font-bold">{name}</span>}
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{email}</span>
                  </span>
                </div>

                {others.length > 0 && (
                  <div className="border-b border-border p-1.5">
                    <div className="px-2 pb-1 pt-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Switch to
                    </div>
                    {others.map((account) => (
                      <button
                        key={account.email}
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={() => void switchTo(account.email)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
                      >
                        <Avatar name={account.email} email={account.email} size={24} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{account.email}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="p-1.5">
                  <ProfileMenuItem
                    icon={<UserPlus size={13} />}
                    label="Add another account"
                    onClick={() => {
                      setProfileOpen(false);
                      router.push('/login?add=1');
                    }}
                  />
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
                </div>

                <div className="border-t border-border p-1.5">
                  <ProfileMenuItem
                    icon={<LogOut size={13} />}
                    label={others.length > 0 ? `Sign out of ${email}` : 'Sign out'}
                    danger
                    onClick={() => {
                      setProfileOpen(false);
                      void signOut(false);
                    }}
                  />
                  {others.length > 0 && (
                    <ProfileMenuItem
                      icon={<LogOut size={13} />}
                      label="Sign out of all accounts"
                      danger
                      onClick={() => {
                        setProfileOpen(false);
                        void signOut(true);
                      }}
                    />
                  )}
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
      className={`flex w-full items-center gap-2 truncate rounded-lg px-3 py-2 text-left text-[12.5px] font-semibold ${
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-muted'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
