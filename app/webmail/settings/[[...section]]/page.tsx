'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, LogOut } from 'lucide-react';
import { SETTINGS_SECTIONS } from '@/components/webmail/settings/sections';
import { getSettings, logout as apiLogout } from '@/lib/webmail/client';
import { toSettings } from '@/lib/webmail/adapters';
import type { WebmailSettings } from '@/components/webmail/types';

/**
 * Settings, as a page rather than a modal.
 *
 * A dialog was the wrong container the moment settings stopped being one
 * short form: it capped the content at a dialog's height, put a scroll
 * region inside a scroll region, could not be linked to, and ignored the
 * back button. As a route each section gets a real URL
 * (/webmail/settings/forwarding) and there is room to grow.
 *
 * The chrome deliberately MATCHES the mailbox: same full-height sidebar
 * (w-56, same border and surface), same header geometry with a w-56 left
 * block so the divider lines up, and content that fills the width. The
 * first attempt centred a narrow card in the viewport, which read as a
 * different application that happened to share a colour scheme -- settings
 * should feel like the same product with the folder list swapped for a
 * section list, which is what SOGo does and what was asked for.
 *
 * An unknown section id falls back to the first rather than 404ing -- a
 * stale bookmark should open settings, not an error.
 */
export default function WebmailSettingsPage() {
  const router = useRouter();
  const params = useParams<{ section?: string[] }>();
  const requested = params?.section?.[0];

  const [settings, setSettings] = useState<WebmailSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const active = SETTINGS_SECTIONS.find((s) => s.id === requested) ?? SETTINGS_SECTIONS[0];
  const ActiveComponent = active.component;

  const handleUnauthorized = useCallback(() => {
    router.push('/webmail/login');
  }, [router]);

  const loadSettings = useCallback(async () => {
    const result = await getSettings(handleUnauthorized);
    if (result.success) {
      setSettings(toSettings(result.data));
      setError(null);
    } else {
      setError(result.message);
    }
  }, [handleUnauthorized]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  /**
   * Sections save explicitly, so navigating away from an edited one loses
   * it. Guarding the in-app moves is the useful half; a full page leave is
   * the limit of what a client route can honestly promise to catch.
   */
  const confirmLeave = () => {
    if (!Object.values(dirty).some(Boolean)) return true;
    return window.confirm('You have unsaved changes in settings. Leave anyway?');
  };

  const goTo = (id: string) => {
    if (!confirmLeave()) return;
    setDirty({});
    router.push(id === SETTINGS_SECTIONS[0].id ? '/webmail/settings' : `/webmail/settings/${id}`);
  };

  const backToMail = () => {
    if (!confirmLeave()) return;
    router.push('/webmail');
  };

  const signOut = async () => {
    await apiLogout();
    sessionStorage.removeItem('mailyte_mailbox_display');
    router.push('/webmail/login');
  };

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-900">
      {/* Same geometry as WebmailHeader: a w-56 left block so the header's
          divider lines up with the sidebar edge below it, instead of the two
          columns disagreeing about where the app starts. */}
      <header className="border-b border-gray-200 dark:border-gray-700 py-2 px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 min-w-0 lg:w-56 shrink-0">
            <button
              onClick={backToMail}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ArrowLeft size={16} />
              <span>Back to mail</span>
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-tight">
              Settings
            </h1>
            {settings && (
              <p className="text-xs text-gray-500 truncate">{settings.emailAddress}</p>
            )}
          </div>

          <button
            onClick={() => void signOut()}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-gray-500 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0"
            title="Sign out"
          >
            <LogOut size={18} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Identical container to WebmailSidebar, so moving between mail and
            settings does not shift the layout under the pointer. */}
        <nav
          aria-label="Settings sections"
          className="hidden md:flex w-56 border-r border-gray-200 dark:border-gray-700 h-full overflow-y-auto bg-gray-50 dark:bg-gray-800 flex-col"
        >
          <div className="px-4 pt-4 pb-2 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Preferences
          </div>

          <div className="pr-2">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = section.id === active.id;
              return (
                <button
                  key={section.id}
                  onClick={() => goTo(section.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center justify-between w-full px-3 py-2 text-sm rounded-r-full ${
                    isActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon size={18} />
                    <span className="truncate">{section.label}</span>
                  </span>
                  {dirty[section.id] && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0"
                      title="Unsaved changes"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Narrow screens get the sections as a strip, since a 224px column
              would leave nothing for the form. */}
          <nav
            aria-label="Settings sections"
            className="md:hidden flex gap-1 px-3 py-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto shrink-0"
          >
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => goTo(section.id)}
                aria-current={section.id === active.id ? 'page' : undefined}
                className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
                  section.id === active.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {section.label}
                {dirty[section.id] && <span className="ml-1.5 text-amber-500">•</span>}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700/60">
              <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {active.label}
              </h2>
              <p className="text-sm text-gray-500">{active.description}</p>
            </div>

            <div className="px-6 py-5">
              {error && (
                <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              )}

              {settings ? (
                <div className="max-w-3xl">
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
                !error && <p className="text-sm text-gray-500">Loading settings…</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
