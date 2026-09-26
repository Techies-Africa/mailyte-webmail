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

  const sendTest = () => {
    try {
      new Notification('Mailyte', { body: 'New mail will show up like this.', icon: '/logo-192.png', tag: 'mailyte-test' });
    } catch {
      // Browsers that only notify from a service worker; the switch still works for toasts.
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
      </section>
    </div>
  );
}
