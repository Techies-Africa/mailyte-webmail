'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Menu as MenuIcon } from 'lucide-react';
import { SETTINGS_SECTIONS } from '@/components/webmail/settings/sections';
import Sidebar from '@/components/webmail/shell/Sidebar';
import SidebarItem, { SidebarDivider, SidebarEyebrow } from '@/components/webmail/shell/SidebarItem';
import { useSidebarCollapsed } from '@/components/webmail/shell/useSidebarCollapsed';
import IconButton from '@/components/ui/IconButton';
import { getSettings } from '@/lib/webmail/client';
import { toSettings } from '@/lib/webmail/adapters';
import type { WebmailSettings } from '@/components/webmail/types';

/**
 * Settings, inside the same shell as the mailbox: the rail stays, with the
 * folder list swapped for the section list, so moving between mail and
 * settings does not read as leaving the product. Each section gets a real
 * URL (/settings/forwarding); an unknown one falls back to the first.
 */
export default function WebmailSettingsPage() {
  const router = useRouter();
  const params = useParams<{ section?: string[] }>();
  const requested = params?.section?.[0];
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [menuOpen, setMenuOpen] = useState(false);

  const [settings, setSettings] = useState<WebmailSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const active = SETTINGS_SECTIONS.find((s) => s.id === requested) ?? SETTINGS_SECTIONS[0];
  const ActiveComponent = active.component;

  const handleUnauthorized = useCallback(() => {
    router.push('/login');
  }, [router]);

  const loadSettings = useCallback(async () => {
    const result = await getSettings(handleUnauthorized);
    if (result.success && result.data) {
      setSettings(toSettings(result.data));
      setError(null);
    } else if (!result.success) {
      setError(result.message);
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  /** Sections save explicitly, so navigating away from an edited one asks first. */
  const confirmLeave = () => {
    if (!Object.values(dirty).some(Boolean)) return true;
    return window.confirm('You have unsaved changes in settings. Leave anyway?');
  };

  const goTo = (id: string) => {
    if (!confirmLeave()) return;
    setDirty({});
    setMenuOpen(false);
    router.push(id === SETTINGS_SECTIONS[0].id ? '/settings' : `/settings/${id}`);
  };

  const leave = (href: string) => {
    if (!confirmLeave()) return;
    router.push(href);
  };

  return (
    <div className="relative flex h-screen overflow-hidden bg-pane">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onCompose={() => leave('/?compose=new')}
        email={settings?.emailAddress ?? ''}
        name={settings?.name ?? null}
        onOpenSettings={() => goTo(SETTINGS_SECTIONS[0].id)}
        onOpenSecurity={() => goTo('security')}
        mobileOpen={menuOpen}
        onCloseMobile={() => setMenuOpen(false)}
      >
        <SidebarItem icon={<ArrowLeft />} label="Back to mail" collapsed={collapsed && !menuOpen} onClick={() => leave('/')} />
        <SidebarDivider />
        <SidebarEyebrow collapsed={collapsed && !menuOpen}>Settings</SidebarEyebrow>
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <SidebarItem
              key={section.id}
              icon={<Icon />}
              label={section.label}
              active={section.id === active.id}
              collapsed={collapsed && !menuOpen}
              badge={dirty[section.id] ? '•' : undefined}
              badgeTone="muted"
              onClick={() => goTo(section.id)}
            />
          );
        })}
      </Sidebar>

      <main className="thin-scroll flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-4 py-3 sm:px-8">
          <IconButton label="Menu" size="sm" onClick={() => setMenuOpen(true)} className="md:hidden">
            <MenuIcon size={15} />
          </IconButton>
          <div className="min-w-0">
            <h1 className="font-display text-[17px] font-bold tracking-tight">{active.label}</h1>
            <p className="truncate text-[12.5px] text-muted-foreground">{active.description}</p>
          </div>
        </div>

        <div className="px-4 py-6 sm:px-8">
          {error && (
            <p className="mb-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          {settings ? (
            <div className="max-w-3xl rounded-xl border border-border bg-card p-5 sm:p-6">
              <ActiveComponent
                key={active.id}
                settings={settings}
                onUnauthorized={handleUnauthorized}
                onSettingsChanged={() => void loadSettings()}
                onDirty={() => setDirty((prev) => ({ ...prev, [active.id]: true }))}
                onSaved={() => setDirty((prev) => ({ ...prev, [active.id]: false }))}
              />
            </div>
          ) : (
            !error && <p className="text-sm text-muted-foreground">Loading settings…</p>
          )}
        </div>
      </main>
    </div>
  );
}
