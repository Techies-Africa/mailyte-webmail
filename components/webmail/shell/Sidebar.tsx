'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  ChevronDown,
  Keyboard,
  LoaderCircle,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plus,
  Power,
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
import { useKeepOnScreen } from '@/components/ui/useKeepOnScreen';
import { signOut, switchAccount } from '@/lib/webmail/client';
import { useAccounts } from '@/lib/webmail/query/accountQueries';
import { SIDEBAR_ID } from '@/lib/webmail/paneLayout';
import { isTypingTarget } from '@/lib/webmail/useKeyboardShortcuts';
import { useIsMobile } from '@/lib/webmail/useIsMobile';
import PaneResizeHandle from './PaneResizeHandle';

type SidebarProps = {
  /**
   * Icons only. Already false on phones (useSidebarCollapsed), where the rail
   * is a drawer that always opens full width.
   */
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
  /** On phones the rail is a drawer, and this says whether it is out. */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  /**
   * What the logo does on the inbox itself. There it cannot be a plain link to
   * "/": the page would not remount, and the address bar would say Inbox while
   * the screen stayed where it was.
   */
  onHome?: () => void;
  /** Asked before leaving for another page from the account menu; false stays. */
  onLeave?: () => boolean;
};

/**
 * The rail.
 *
 * Dark in both themes: an ink column with the lockup at the top, a filled
 * Compose button, the navigation, and at the bottom the theme switch and a
 * profile chip. The chip's menu is also the account switcher: every mailbox
 * signed in on this browser is listed, one click moves between them, and
 * sign-out is per mailbox or for all of them.
 *
 * At md and up its right edge can be dragged (PaneResizeHandle); the width
 * is a CSS variable, never a React value, so a server-rendered rail is drawn
 * at the remembered width from the first paint.
 *
 * On a phone it is a drawer that slides in over a dimmed page and slides back
 * out. It is always mounted, so both directions can animate; closed, it is
 * `visibility: hidden` once the slide ends, which takes its links out of the
 * Tab order and the accessibility tree. Opening moves focus to Close, closing
 * hands it back, and Escape closes it unless something inside it -- the
 * account menu, a folder's menu or dialog, a folder name being typed -- takes
 * the key first.
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
  onHome,
  onLeave,
}: SidebarProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [profileOpen, setProfileOpen] = useState(false);
  /** The mailbox being switched to: its row shows a spinner until the page reloads into it. */
  const [switching, setSwitching] = useState<string | null>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  // Who else is signed in here. Loaded once per tab; the list only changes
  // through this menu or the login page, both of which reload the document.
  const accounts = useAccounts().data ?? [];

  // Escape closes the account menu, like every other floating panel here.
  useEffect(() => {
    if (!profileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Handled, so the phone drawer around it stays open.
      event.preventDefault();
      setProfileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [profileOpen]);

  const others = accounts.filter((a) => !a.active && a.email !== email.toLowerCase());

  const isMobile = useIsMobile();
  // Read when the menu renders -- only ever after a click -- so no hydration question arises.
  const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useKeepOnScreen(menuRef, profileOpen);
  // Read through a ref: callers pass a fresh arrow each render, and the
  // listeners below should not re-attach -- and so move behind the ones they
  // must run after -- every time the page re-renders.
  const onCloseMobileRef = useRef(onCloseMobile);
  useEffect(() => {
    onCloseMobileRef.current = onCloseMobile;
  }, [onCloseMobile]);

  // Escape closes the drawer. On window, so every menu and dialog (on
  // document) has had the key first; one that closed itself marks it
  // handled, and the drawer stays. A folder name being typed keeps its own
  // Escape too.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isTypingTarget(event.target)) return;
      event.preventDefault();
      onCloseMobileRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Opening moves focus into the drawer; closing hands it back to whatever
  // opened it -- only if focus is still inside (Compose has already moved it
  // to the new window).
  useEffect(() => {
    if (mobileOpen) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closeRef.current?.focus();
      return;
    }
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (back?.isConnected && asideRef.current?.contains(document.activeElement)) back.focus();
  }, [mobileOpen]);

  // Widening past md with the drawer out would leave a desktop rail that
  // thinks it is a drawer.
  useEffect(() => {
    if (!isMobile && mobileOpen) onCloseMobileRef.current?.();
  }, [isMobile, mobileOpen]);

  const switchTo = async (target: string) => {
    setSwitching(target);
    const error = await switchAccount(target);
    if (error) {
      setSwitching(null);
      toast(error, { tone: 'error' });
    }
  };

  const rail = collapsed;

  return (
    <>
      {/* Always mounted, so it can fade out as well as in. */}
      <div
        aria-hidden
        onClick={onCloseMobile}
        className={[
          'fixed inset-0 z-30 bg-black/50 transition-[opacity,visibility] duration-200 md:hidden',
          mobileOpen ? 'visible opacity-100' : 'pointer-events-none invisible opacity-0',
        ].join(' ')}
      />

      <aside
        ref={asideRef}
        id={SIDEBAR_ID}
        aria-label="Navigation"
        data-sidebar=""
        data-collapsed={rail ? '' : undefined}
        className={[
          // pane-rail: 228px on a phone, the remembered width at md and up (globals.css).
          'pane-rail flex h-full shrink-0 flex-col bg-sidebar pb-3.5 text-sidebar-foreground duration-200 ease-out',
          'fixed inset-y-0 left-0 z-40 md:relative md:z-auto',
          // Opening does not transition visibility, so the drawer is visible
          // at once and Close can take focus in the same task; closing does,
          // so it stays visible until the slide has finished. transform-none,
          // not translate-x-0: a transformed box is the containing block for
          // its fixed children, which shut the account menu's click-away
          // layer and the delete-folder dialog inside the rail.
          mobileOpen
            ? 'visible transform-none transition-[width,transform]'
            : 'invisible -translate-x-full transition-[width,transform,visibility] md:visible md:transform-none',
        ].join(' ')}
      >
        <div className={`flex shrink-0 items-center px-3 pb-2.5 pt-3.5 ${rail ? 'justify-center' : 'justify-between'}`}>
          {!rail && (
            <Link
              href="/"
              aria-label="Inbox"
              className="flex min-w-0 items-center"
              onClick={(e) => {
                // A modified click still opens a new tab; a plain one stays on this page.
                if (!onHome || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onHome();
              }}
            >
              <BrandLockup height={24} tone="dark" />
            </Link>
          )}
          {/* Both, split by breakpoint rather than by mobileOpen, so the X
              does not vanish halfway through the slide out. */}
          <IconButton ref={closeRef} label="Close menu" tone="onDark" size="md" onClick={onCloseMobile} className="md:hidden">
            <X size={15} />
          </IconButton>
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls={SIDEBAR_ID}
            tone="onDark"
            size="md"
            onClick={onToggleCollapsed}
            className="hidden md:inline-flex"
          >
            <MenuIcon size={15} />
          </IconButton>
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
              {/* Above the docked compose windows (z-140 and up): with a wide
                  rail the menu opens over them. */}
              <div aria-hidden onClick={() => setProfileOpen(false)} className="fixed inset-0 z-[155]" />
              {/* Its own width, not the rail's. Stretched to the rail it was
                  180px wide once the rail was dragged to its narrowest, and
                  every address in it was cut short. Wider than the rail it
                  spills over the page; on a phone it is nudged back on screen;
                  on a short screen the middle scrolls, so the other accounts
                  and sign-out stay reachable instead of running off the top. */}
              <div
                ref={menuRef}
                role="menu"
                aria-label="Account"
                className="absolute bottom-[calc(100%+6px)] left-0 z-[160] flex max-h-[calc(100dvh-7.5rem)] w-72 min-w-[min(100%,360px)] max-w-[calc(100vw-1.25rem)] animate-fade-in flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-panel"
              >
                <div className="flex shrink-0 items-center gap-3 border-b border-border px-3.5 py-3">
                  <Avatar name={name ?? email} email={email} size={36} />
                  <span className="min-w-0 flex-1">
                    {name && <span className="block truncate text-[13px] font-semibold">{name}</span>}
                    {/* Wraps rather than truncates: which mailbox this is must be readable in full. */}
                    <span className="block text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{email}</span>
                  </span>
                </div>

                <div className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                          disabled={switching !== null}
                          onClick={() => void switchTo(account.email)}
                          title={account.email}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-60"
                        >
                          <Avatar name={account.email} email={account.email} size={28} />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">{account.email}</span>
                          {switching === account.email && (
                            <LoaderCircle size={14} aria-hidden className="shrink-0 animate-spin text-muted-foreground" />
                          )}
                        </button>
                      ))}
                      {switching && (
                        <p role="status" className="sr-only">
                          Switching to {switching}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="p-1.5">
                    <ProfileMenuItem
                      icon={<UserPlus size={13} />}
                      label="Add another account"
                      onClick={() => {
                        setProfileOpen(false);
                        if (onLeave && !onLeave()) return;
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
                    {/* Not on a touch screen, where there is no keyboard to use them. */}
                    {onShowShortcuts && canHover && (
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
                </div>

                <div className="shrink-0 border-t border-border p-1.5">
                  <ProfileMenuItem
                    icon={<LogOut size={13} />}
                    label="Sign out"
                    hint={others.length > 0 ? email : undefined}
                    danger
                    onClick={() => {
                      setProfileOpen(false);
                      void signOut(false);
                    }}
                  />
                  {others.length > 0 && (
                    <ProfileMenuItem
                      icon={<Power size={13} />}
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

        {!rail && (
          <PaneResizeHandle pane="rail" controls={SIDEBAR_ID} label="Resize sidebar" className="left-full hidden md:block" />
        )}
      </aside>
    </>
  );
}

function ProfileMenuItem({
  icon,
  label,
  hint,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  /** A second, muted line: which mailbox a sign-out is for. */
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      title={hint ? `${label} (${hint})` : label}
      aria-label={hint ? `${label}, ${hint}` : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] font-semibold ${
        danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-muted'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {hint && <span className="block truncate text-[11px] font-normal text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}
