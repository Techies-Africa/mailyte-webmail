'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'mailyte.webmail.sidebarCollapsed';

/**
 * Whether the rail is collapsed to icons. Remembered per browser, read after
 * mount so the first paint matches the server's (open).
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      // Reading storage is a side effect, which is what an effect is for.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.localStorage.getItem(KEY) === '1');
    } catch {
      // Private mode; stays open.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        // Not worth failing a click over.
      }
      return next;
    });
  }, []);

  return [collapsed, toggle];
}
