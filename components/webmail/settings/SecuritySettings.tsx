import WebmailSecuritySection from '../WebmailSecuritySection';
import type { SettingsSectionProps } from './types';

/**
 * Two-factor and sign-in history. The panel itself predates the settings
 * shell; this is the registry adapter for it.
 */
export default function SecuritySettings({ onUnauthorized }: SettingsSectionProps) {
  return <WebmailSecuritySection onUnauthorized={onUnauthorized} />;
}
