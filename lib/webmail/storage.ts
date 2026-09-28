/** "850 MB", "4.1 GB". */
export function formatMb(mb: number): string {
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export type StorageLevel = 'ok' | 'almost-full' | 'full';

/**
 * Where a mailbox's fill stands: the same lines mailyte-api warns at
 * (CheckMailboxStorageJob, 80% and 100%). No quota, or no figure, is 'ok':
 * a mailbox without a limit cannot fill, and an unknown is not a warning.
 */
export function storageLevel(percentage: number | null, quotaMb: number): StorageLevel {
  if (percentage === null || quotaMb <= 0) return 'ok';
  if (percentage >= 100) return 'full';
  if (percentage >= 80) return 'almost-full';
  return 'ok';
}

/** How long the mail server holds mail for a full mailbox before returning it (Postfix maximal_queue_lifetime). */
export const HELD_DAYS = 10;
