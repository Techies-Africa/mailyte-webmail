'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookUser, CalendarDays, Settings } from 'lucide-react';
import Sidebar from './Sidebar';
import SidebarItem, { SidebarDivider } from './SidebarItem';
import { useSidebarCollapsed } from './useSidebarCollapsed';
import { useCapabilities, useSettings } from '@/lib/webmail/query/accountQueries';
import { SIDEBAR_ID } from '@/lib/webmail/paneLayout';

type PageShellProps = {
  /** Which rail row is lit. */
  current: 'calendar' | 'contacts';
  children: React.ReactNode;
};

const PageMenuContext = createContext<[boolean, () => void]>([false, () => {}]);

/**
 * The phone menu, for a page header inside PageShell: whether the drawer is
 * out (for the Menu button's aria-expanded) and the opener.
 */
export function usePageMenu(): [boolean, () => void] {
  return useContext(PageMenuContext);
}

/** Props for a page header's Menu button, so all of them announce the drawer the same way. */
export const pageMenuButtonProps = (open: boolean) => ({ 'aria-expanded': open, 'aria-controls': SIDEBAR_ID });

/**
 * The rail around the calendar and address-book screens.
 *
 * They are separate routes with their own data, but they belong to the same
 * product as the inbox, so they keep the same dark rail: Compose still
 * composes (it lands on the inbox with a window open), and the account chip
 * still opens settings and signs out.
 */
export default function PageShell({ current, children }: PageShellProps) {
  const router = useRouter();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [menuOpen, setMenuOpen] = useState(false);
  // Shared with the inbox and every other screen: a revisit paints at once.
  const capabilities = useCapabilities().data;
  const email = capabilities?.email_address ?? '';
  const name = useSettings().data?.name ?? null;
  const caps = capabilities
    ? {
        calendar: capabilities.capabilities?.calendar === true,
        contacts: capabilities.capabilities?.contacts === true,
      }
    : null;

  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const menu = useMemo<[boolean, () => void]>(() => [menuOpen, openMenu], [menuOpen, openMenu]);

  // h-dvh: 100vh on iOS is taller than what is visible, which hid the rail's
  // account chip behind the browser's toolbar.
  return (
    <div className="relative flex h-dvh overflow-hidden bg-pane">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onCompose={() => router.push('/?compose=new')}
        email={email}
        name={name}
        onOpenSettings={() => router.push('/settings')}
        onOpenSecurity={() => router.push('/settings/security')}
        mobileOpen={menuOpen}
        onCloseMobile={closeMenu}
      >
        <SidebarItem icon={<ArrowLeft />} label="Back to mail" collapsed={collapsed} as="a" href="/" />
        <SidebarDivider />
        {(caps?.calendar ?? current === 'calendar') && (
          <SidebarItem icon={<CalendarDays />} label="Calendar" active={current === 'calendar'} collapsed={collapsed} as="a" href="/calendar" />
        )}
        {(caps?.contacts ?? current === 'contacts') && (
          <SidebarItem icon={<BookUser />} label="Contacts" active={current === 'contacts'} collapsed={collapsed} as="a" href="/address-book" />
        )}
        <SidebarDivider />
        <SidebarItem icon={<Settings />} label="Settings" collapsed={collapsed} as="a" href="/settings" />
      </Sidebar>

      <PageMenuContext.Provider value={menu}>{children}</PageMenuContext.Provider>
    </div>
  );
}
