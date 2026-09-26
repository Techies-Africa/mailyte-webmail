import type { ComponentType } from 'react';
import { Settings2, PenSquare, Forward, Plane, ShieldCheck, Palette, CalendarDays, Ban, ListFilter, Bell } from 'lucide-react';
import GeneralSettings from './GeneralSettings';
import ComposingSettings from './ComposingSettings';
import RulesSettings from './RulesSettings';
import ForwardingSettings from './ForwardingSettings';
import VacationSettings from './VacationSettings';
import BlockedSendersSettings from './BlockedSendersSettings';
import SecuritySettings from './SecuritySettings';
import AppearanceSettings from './AppearanceSettings';
import CalendarSettings from './CalendarSettings';
import NotificationSettings from './NotificationSettings';
import type { SettingsSectionProps } from './types';

/**
 * The settings registry.
 *
 * Adding a settings area is ONE entry here: the shell reads this list to
 * build its navigation, its routing and its heading. Each section owns its
 * own loading, saving and validation (see SettingsSectionProps).
 *
 * Ordered the way a mailbox holder looks for things: the everyday ones
 * first, the ones you set up once at the end.
 *
 * Deliberately ABSENT, per the PRD's rule that a control which does nothing
 * is removed rather than greyed:
 *   - Labels: managed from the message itself and the sidebar, where folders
 *     already live. A rule can set one (see Rules).
 *
 * Calendar is listed unconditionally even though the calendar service is
 * optional: the section explains how to reach the calendar from other apps,
 * and a deployment without the service answers with a clear message. The
 * calendar SCREEN is gated on the capability (app/calendar/page.tsx).
 */
export interface SettingsSection {
  id: string;
  label: string;
  /** Shown under the heading. One line on what this section is for. */
  description: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  component: ComponentType<SettingsSectionProps>;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Your name, signature, how the message list looks, and storage.',
    icon: Settings2,
    component: GeneralSettings,
  },
  {
    id: 'composing',
    label: 'Composing',
    description: 'How writing and sending behave, including undo send.',
    icon: PenSquare,
    component: ComposingSettings,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'A desktop notification when new mail arrives.',
    icon: Bell,
    component: NotificationSettings,
  },
  {
    id: 'rules',
    label: 'Rules',
    description: 'Sort mail as it arrives: move it, label it, star it, or send a copy on.',
    icon: ListFilter,
    component: RulesSettings,
  },
  {
    id: 'forwarding',
    label: 'Forwarding',
    description: 'Send incoming mail on to another address.',
    icon: Forward,
    component: ForwardingSettings,
  },
  {
    id: 'vacation',
    label: 'Vacation',
    description: 'Reply automatically while you are away.',
    icon: Plane,
    component: VacationSettings,
  },
  {
    id: 'blocked',
    label: 'Blocked senders',
    description: 'Addresses whose mail is filed to Junk on arrival.',
    icon: Ban,
    component: BlockedSendersSettings,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'Use this calendar in Apple Calendar, Thunderbird, Android or Outlook.',
    icon: CalendarDays,
    component: CalendarSettings,
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Two-factor authentication and where you are signed in.',
    icon: ShieldCheck,
    component: SecuritySettings,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'The accent colour used across your mailbox.',
    icon: Palette,
    component: AppearanceSettings,
  },
];
