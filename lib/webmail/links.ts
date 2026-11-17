/**
 * Does this sent email contain a web link that click tracking could follow?
 *
 * An email with no links can never be "clicked", so the delivery panel should
 * not show a Clicked step (or "not yet") for it. Only HTML mail is tracked, and
 * only http(s) links are: a `mailto:` link or a plain-text address is not.
 */
export function hasTrackableLinks(body: string, isHtml: boolean): boolean {
  return isHtml && /<a\s[^>]*\bhref\s*=\s*["']?\s*https?:\/\//i.test(body);
}
