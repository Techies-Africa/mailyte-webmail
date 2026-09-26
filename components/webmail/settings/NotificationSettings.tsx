'use client';

import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Switch } from '@/components/ui/Field';
import {
  desktopNotificationsOn,
  enableNotifications,
  notificationsSupported,
  storeNotifyPref,
} from '@/lib/webmail/newMail';
import type { SettingsSectionProps } from './types';

type Status = 'loading' | 'unsupported' | 'blocked' | 'on' | 'off';

function currentStatus(): Status {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return desktopNotificationsOn() ? 'on' : 'off';
}

/**
 * Notifications: the desktop notice for new mail.
 *
 * A per-device preference, like Appearance -- a work laptop and a shared
 * family computer want different answers -- so nothing is saved to the
 * server and onDirty/onSaved are never called.
 */
export default function NotificationSettings(_props: SettingsSectionProps) {
  const [status, setStatus] = useState<Status>('loading');
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(currentStatus());
  }, []);

  const turn = async (on: boolean) => {
    if (!on) {
      storeNotifyPref('off');
      setStatus('off');
      return;
    }
    setAsking(true);
    const result = await enableNotifications();
    setAsking(false);
    setStatus(result === 'granted' ? 'on' : currentStatus());
    if (result === 'granted') sendTest();
  };

  /**
   * What happened to the last test. The browser gives the page no word when
   * the OPERATING SYSTEM hides a notification (macOS with the browser's
   * notifications off, or Focus on) -- so the button always says it sent one
   * and where to look, instead of doing "nothing".
   */
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);

  const sendTest = () => {
    try {
      // No tag: a fixed one made every click after the first silently
      // replace the earlier test wherever the system had filed it, which
      // looked exactly like a button that does nothing.
      const notification = new Notification('Mailyte', {
        body: 'New mail will show up like this.',
        icon: '/logo-192.png',
      });
      notification.onerror = () => setTestNote({ ok: false, text: 'Your browser refused to show the test.' });
      setTestNote({ ok: true, text: `Test sent at ${new Date().toLocaleTimeString()}.` });
    } catch (error) {
      // Some mobile browsers only notify from a service worker.
      setTestNote({
        ok: false,
        text: `This browser would not show it${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
      });
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-display text-[14px] font-semibold">New mail</h3>
        <p className="mb-3 mt-1 max-w-2xl text-[13px] text-muted-foreground">
          A desktop notification when an email reaches the Inbox of any account signed in on this browser, while
          Mailyte is open in a tab, including a tab in the background. Mail sorted into Promotions, Social, Updates
          or Junk does not notify. While you are looking at your mailbox, new mail shows as a message at the
          bottom of the screen instead.
        </p>

        {status === 'unsupported' && (
          <p className="text-[13px] text-muted-foreground">This browser cannot show notifications.</p>
        )}

        {status === 'blocked' && (
          <p className="max-w-2xl rounded-lg border border-border bg-muted/40 p-3 text-[13px]">
            Your browser is blocking notifications from this site. Allow them in the site settings (the icon to the
            left of the address bar), then come back here.
          </p>
        )}

        {(status === 'on' || status === 'off') && (
          <div className="flex flex-wrap items-center gap-4">
            <Switch
              checked={status === 'on'}
              onChange={(next) => void turn(next)}
              disabled={asking}
              label="Notify me about new mail on this device"
            />
            {status === 'on' && (
              <Button variant="secondary" size="sm" icon={<BellRing size={13} />} onClick={sendTest}>
                Send a test
              </Button>
            )}
          </div>
        )}

        {status === 'on' && testNote && (
          <div
            role="status"
            className="mt-4 max-w-2xl rounded-lg border border-border bg-muted/40 p-3 text-[13px] leading-relaxed"
          >
            <p className={testNote.ok ? 'font-medium' : 'font-medium text-destructive'}>{testNote.text}</p>
            <p className="mt-1 text-muted-foreground">
              Nothing on screen? Your computer may be hiding this browser&apos;s notifications. On a Mac: System
              Settings → Notifications → your browser (for example Google Chrome) → Allow notifications, and check
              that Focus or Do Not Disturb is off; it may also be waiting in Notification Center (click the clock). On
              Windows: Settings → System → Notifications → your browser.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
