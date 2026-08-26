import type { WebmailSettings } from '../types';

/**
 * What every settings section receives.
 *
 * Sections are self-contained: each one loads and saves its own data rather
 * than the shell threading state through. That is what makes adding a
 * section a single registry entry instead of an edit in four places -- see
 * `sections.ts`.
 */
export interface SettingsSectionProps {
  onUnauthorized: () => void;
  /** The account-level settings the shell already loaded, where relevant. */
  settings: WebmailSettings;
  /** Called on the first edit, so the shell can warn before navigating away. */
  onDirty?: () => void;
  /**
   * Called after a successful save. The shell clears this section's unsaved
   * marker on it -- without it, saving leaves the flag set and the next
   * navigation asks about changes that are already stored.
   */
  onSaved?: () => void;
  /** Refresh the shell's copy of account settings after a save. */
  onSettingsChanged?: () => void;
}
