/**
 * Cloudflare Turnstile on sign-in (feedback 2026-10-07: bots trying
 * passwords). Off unless BOTH keys are set where the container runs: a
 * secret without a site key would refuse every sign-in, since no browser
 * could ever produce a token.
 *
 * Cloudflare's test keys, for local work: site key 1x00000000000000000000AA
 * with secret 1x0000000000000000000000000000000AA always passes; secret
 * 2x0000000000000000000000000000000AA always fails.
 */
export function turnstileKeys(): { siteKey: string; secret: string } | null {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  return siteKey && secret ? { siteKey, secret } : null;
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Whether `token` is a solved challenge Cloudflare has not seen before. A
 * token is good for one check and five minutes, so the sign-in form fetches
 * a fresh one for every attempt, the two-factor step included.
 *
 * Fails CLOSED when Cloudflare says no or answers 4xx, and OPEN when
 * Cloudflare cannot be asked (timeout, a 5xx, an answer that is not JSON):
 * that must not lock every mailbox holder out of their mail, nothing a
 * visitor sends can cause it, and the mail server's own per-IP failed-login
 * limit still stands behind this.
 */
export async function verifyTurnstile(secret: string, token: unknown, remoteIp: string | null): Promise<boolean> {
  if (typeof token !== 'string' || token === '' || token.length > 2048) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set('remoteip', remoteIp);
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    // Only Cloudflare failing opens the gate; a 4xx (429 included) is
    // something a flood of sign-in attempts can cause.
    if (res.status >= 500) throw new Error(`siteverify answered ${res.status}`);
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (error) {
    console.warn('Turnstile could not be checked; letting this sign-in through', error);
    return true;
  }
}
