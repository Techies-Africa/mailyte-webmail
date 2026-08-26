import type { ComponentType } from 'react';
import { Settings2, PenSquare, Forward, Plane, ShieldCheck } from 'lucide-react';
import GeneralSettings from './GeneralSettings';
import ComposingSettings from './ComposingSettings';
import ForwardingSettings from './ForwardingSettings';
import VacationSettings from './VacationSettings';
import SecuritySettings from './SecuritySettings';
import type { SettingsSectionProps } from './types';

/**
 * The settings registry.
 *
 * Adding a settings area is ONE entry here: the shell reads this list to
 * build its navigation, its routing and its heading, so a new section needs
 * no edit to the shell at all. Each section owns its own loading, saving and
 * validation (see SettingsSectionProps), which is what keeps that true --
 * the moment the shell starts threading state per-section, adding one stops
 * being a single change.
 *
 * Ordered the way a mailbox holder looks for things, not alphabetically:
 * the everyday ones first, the ones you set up once at the end.
 *
 * Deliberately ABSENT until each has a working backend, per the PRD's rule
 * that a control which does nothing is removed rather than greyed:
 *   - Filter rules: the compiler and endpoints exist and the Sieve backend
 *     now works, but the rule-builder UI is not built yet.
 *   - Labels: managed from the sidebar, where folders already live.
 *   - IMAP accounts: no backend of any kind.
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
    description: 'Your signature, how the message list looks, and storage.',
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
    id: 'security',
    label: 'Security',
    description: 'Two-factor authentication and where you are signed in.',
    icon: ShieldCheck,
    component: SecuritySettings,
  },
];
