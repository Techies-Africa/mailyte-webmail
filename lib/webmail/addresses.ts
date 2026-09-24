/** A To/Cc/Bcc field as typed ("a@x.com, b@y.com") to the list the API takes. */
export function splitAddresses(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
