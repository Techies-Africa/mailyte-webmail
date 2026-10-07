import { connection } from 'next/server';
import { turnstileKeys } from '@/lib/webmail/turnstile';
import LoginForm from './LoginForm';

/**
 * Rendered per request, not once at build: the Turnstile site key is set
 * where the container runs, like MAILBOX_API_BASE_URL, and a page
 * prerendered at build would carry the build machine's -- none. Only the
 * public site key crosses to the browser; the secret stays in the login route.
 */
export default async function LoginPage() {
  await connection();
  return <LoginForm turnstileSiteKey={turnstileKeys()?.siteKey ?? ''} />;
}
