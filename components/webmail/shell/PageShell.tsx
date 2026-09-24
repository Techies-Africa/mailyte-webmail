'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookUser, CalendarDays, Settings } from 'lucide-react';
import Sidebar from './Sidebar';
import SidebarItem, { SidebarDivider } from './SidebarItem';
import { useSidebarCollapsed } from './useSidebarCollapsed';
import { getCapabilities, getSettings, logout as apiLogout } from '@/lib/webmail/client';

type PageShellProps = {
  /** Which rail row is lit. */
  current: 'calendar' | 'contacts';
  children: React.ReactNode;
  /** Reported up so the page can gate itself; the page shows nothing until the server answers. */
  onCapabilities?: (caps: { calendar: boolean; contacts: boolean }) => void;
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
export default function PageShell({ current, children, onCapabilities }: PageShellProps) {
  const router = useRouter();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [menuOpen, setMenuOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [caps, setCaps] = useState<{ calendar: boolean; contacts: boolean } | null>(null);

  const onUnauthorized = useCallback(() => router.replace('/login'), [router]);

  useEffect(() => {
    void getCapabilities(onUnauthorized).then((result) => {
      if (!result.success || !result.data) return;
      const next = {
        calendar: result.data.capabilities?.calendar === true,
        contacts: result.data.capabilities?.contacts === true,
      };
      setCaps(next);
      onCapabilities?.(next);
      if (result.data.email_address) setEmail(result.data.email_address);
    });
    void getSettings(onUnauthorized).then((result) => {
      if (result.success && result.data) setName(result.data.name ?? null);
    });
    // onCapabilities is a page-level setter; re-running on its identity would refetch for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onUnauthorized]);

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
        onLogout={async () => {
          await apiLogout();
          sessionStorage.removeItem('mailyte_mailbox_display');
          router.push('/login');
        }}
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
