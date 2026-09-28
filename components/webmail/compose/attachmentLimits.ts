/** Matches SendMailboxMessageRequest's own limits. Shared by the compose
 *  window and the inline reply, so the two cannot disagree. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why `incoming` cannot be added to `current`, or null when it can. */
export function attachmentProblem(current: File[], incoming: File[]): string | null {
  const tooBig = incoming.find((f) => f.size > MAX_ATTACHMENT_BYTES);
  if (tooBig) return `"${tooBig.name}" is ${formatBytes(tooBig.size)} — the limit is 25 MB per file.`;
  if (current.length + incoming.length > MAX_ATTACHMENTS) return `You can attach up to ${MAX_ATTACHMENTS} files.`;
  const total = [...current, ...incoming].reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) return 'Attachments total more than 25 MB.';
  return null;
}
