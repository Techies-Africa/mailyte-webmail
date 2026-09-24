'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookUser, CalendarDays, Settings } from 'lucide-react';
import Sidebar from './Sidebar';
import SidebarItem, { SidebarDivider } from './SidebarItem';
import { useSidebarCollapsed } from './useSidebarCollapsed';
import { useCapabilities, useSettings } from '@/lib/webmail/query/accountQueries';

type PageShellProps = {
  /** Which rail row is lit. */
  current: 'calendar' | 'contacts';
  children: React.ReactNode;
};

const PageMenuContext = createContext<() => void>(() => {});

/** The phone menu trigger, for a page header inside PageShell. */
export function useOpenPageMenu(): () => void {
  return useContext(PageMenuContext);
}

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

  const rail = collapsed && !menuOpen;
  const openMenu = useCallback(() => setMenuOpen(true), []);

  return (
    <div className="relative flex h-screen overflow-hidden bg-pane">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onCompose={() => router.push('/?compose=new')}
        email={email}
        name={name}
        onOpenSettings={() => router.push('/settings')}
        onOpenSecurity={() => router.push('/settings/security')}
        mobileOpen={menuOpen}
        onCloseMobile={() => setMenuOpen(false)}
      >
        <SidebarItem icon={<ArrowLeft />} label="Back to mail" collapsed={rail} as="a" href="/" />
        <SidebarDivider />
        {(caps?.calendar ?? current === 'calendar') && (
          <SidebarItem icon={<CalendarDays />} label="Calendar" active={current === 'calendar'} collapsed={rail} as="a" href="/calendar" />
        )}
        {(caps?.contacts ?? current === 'contacts') && (
          <SidebarItem icon={<BookUser />} label="Contacts" active={current === 'contacts'} collapsed={rail} as="a" href="/address-book" />
        )}
        <SidebarDivider />
        <SidebarItem icon={<Settings />} label="Settings" collapsed={rail} as="a" href="/settings" />
      </Sidebar>

      <PageMenuContext.Provider value={openMenu}>{children}</PageMenuContext.Provider>
    </div>
  );
}
