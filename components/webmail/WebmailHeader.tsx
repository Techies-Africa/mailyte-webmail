import { Menu, RefreshCw, Search, LogOut, Settings, Sun, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { brand } from '@/lib/webmail/brand';

type WebmailHeaderProps = {
  email: string;
  unreadCount: number;
  onToggleSidebar?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  /** Fired on Enter/Escape -- lets the caller run a server round trip. */
  onSearchSubmit: (value: string) => void;
  searchPlaceholder: string;
  onRefresh: () => void;
  refreshing?: boolean;
  onLogout: () => void;
  /** Opens the settings panel (PRD S1). Absent = no gear rendered. */
  onOpenSettings?: () => void;
};

export default function WebmailHeader({
  email,
  unreadCount,
  onToggleSidebar,
  search,
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder,
  onRefresh,
  refreshing = false,
  onLogout,
  onOpenSettings,
}: WebmailHeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = resolvedTheme === 'dark';

  return (
    <header className="border-b border-gray-200 dark:border-gray-700 py-2 px-4 shrink-0">
      <div className="flex items-center gap-2">
        {/* Brand block. Width matches WebmailSidebar's w-56 so the search box
            starts exactly where the folder column ends, instead of drifting
            with the length of the signed-in address. */}
        <div className="flex items-center gap-2 min-w-0 lg:w-56 shrink-0">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0"
              title="Toggle folders"
              aria-label="Toggle folders"
            >
              <Menu size={20} className="text-gray-600 dark:text-gray-300" />
            </button>
          )}

          {/* The mark ships in public/. It was referenced but never
              committed, so it 404'd on every load and the header showed a
              bare wordmark. The name comes from brand.name so a self-hoster
              can rename the app without editing this file; it was hardcoded
              to "Mailyte", which made NEXT_PUBLIC_BRAND_NAME do nothing
              here. Replacing public/logo-mark.png rebrands the mark. */}
          <a
            href="/"
            className="flex items-center gap-2 min-w-0"
            aria-label={`${brand.name} webmail`}
          >
            <img
              src="/logo-mark.png"
              alt=""
              className="h-7 w-auto object-contain shrink-0"
            />
            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100 hidden sm:block">
              {brand.name}
            </span>
          </a>
        </div>

        {/* Search takes the free middle space rather than a fixed 160px at
            the right edge, so it reads as the app's primary control. */}
        <div className="flex-1 min-w-0 flex justify-center">
          <div
            className={`hidden sm:flex items-center w-full max-w-2xl transition-colors duration-200 ${
              searchFocused
                ? 'bg-white dark:bg-gray-800 shadow-sm'
                : 'bg-gray-100 dark:bg-gray-700/60'
            } rounded-full border border-gray-200 dark:border-gray-700 px-3 py-1.5`}
          >
            <Search size={16} className="text-gray-400 flex-shrink-0" />
            <input
              type="search"
              data-webmail-search
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearchSubmit(search);
                if (e.key === 'Escape') {
                  onSearchChange('');
                  onSearchSubmit('');
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="ml-2 bg-transparent border-none outline-none text-sm w-full"
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Whose mailbox this is. On the left it competed with the brand
              for the corner; here it reads as account context, the way a
              mail client's account chip does. */}
          <div className="hidden md:block text-right mr-1 min-w-0 max-w-[16rem]">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{email}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {unreadCount} unread {unreadCount === 1 ? 'message' : 'messages'}
            </p>
          </div>

          <button
            onClick={onRefresh}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Refresh"
          >
            <RefreshCw
              size={20}
              className={`text-gray-500 dark:text-gray-400 ${refreshing ? 'animate-spin' : ''}`}
            />
          </button>

          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            title={mounted && isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {mounted && isDark ? (
              <Sun size={20} className="text-gray-500 dark:text-gray-400" />
            ) : (
              <Moon size={20} className="text-gray-500 dark:text-gray-400" />
            )}
          </button>

          {/* The gear was a dead control until S1 gave it a real panel;
              it is rendered only when there is one to open. */}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Settings"
              aria-label="Settings"
            >
              <Settings size={20} className="text-gray-500 dark:text-gray-400" />
            </button>
          )}

          <button
            onClick={onLogout}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Log out"
          >
            <LogOut size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>
      </div>
    </header>
  );
}
