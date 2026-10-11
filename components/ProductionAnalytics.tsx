import { connection } from 'next/server';
import Script from 'next/script';

function analyticsScript(googleTagId: string, clarityTagId: string) {
  return `
(function () {
  var host = window.location.hostname;
  var isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^10\\./.test(host) ||
    /^192\\.168\\./.test(host) ||
    /^172\\.(1[6-9]|2\\d|3[0-1])\\./.test(host);

  if (isLocal) return;

  // The sign-in page only (owner, 2026-10-11): inside the app a recording
  // is people's mail. Its inputs, addresses and errors stay masked; only its
  // fixed words are unmasked (components/auth/AuthLayout).
  var onLanding = function () {
    return window.location.pathname.replace(/\\/+$/, '') === '/login';
  };
  if (!onLanding()) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(){window.dataLayer.push(arguments);};

  var gtagScript = document.createElement('script');
  gtagScript.async = true;
  gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=${googleTagId}';
  document.head.appendChild(gtagScript);

  window.gtag('js', new Date());
  window.gtag('config', '${googleTagId}');

  (function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window, document, 'clarity', 'script', '${clarityTagId}');

  // Sign-in leaves with a full page load, so neither tag survives into the
  // app. Should anything ever leave this page in-app instead, both stop.
  var watch = window.setInterval(function () {
    if (onLanding()) return;
    window.clearInterval(watch);
    window['ga-disable-${googleTagId}'] = true;
    if (typeof window.clarity === 'function') window.clarity('stop');
  }, 500);
})();
`;
}

/**
 * The tracking tags, on the sign-in page only (app/login/page.tsx), when
 * this deployment has both ids. Nowhere inside the app: a recording there
 * would be people's mail (owner, 2026-10-11).
 *
 * `connection()` makes this read them at REQUEST time, which is the whole
 * point: they are set where the container runs, exactly like
 * MAILBOX_API_BASE_URL (lib/webmail/server.ts), and the image is built
 * without them. Until 2026-10-07 this component ran only at build time, when
 * both are empty, so it returned null and nothing was ever recorded in
 * production -- on any page.
 *
 * Rendered by the sign-in page, which is already rendered per request (it
 * reads the Turnstile site key at run time too).
 */
export async function ProductionAnalytics() {
  await connection();
  const googleTagId = process.env.GOOGLE_ANALYTICS_ID;
  const clarityTagId = process.env.CLARITY_PROJECT_ID;

  if (process.env.NODE_ENV !== 'production' || !googleTagId || !clarityTagId) {
    return null;
  }

  return (
    <Script
      id="production-analytics"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{ __html: analyticsScript(googleTagId, clarityTagId) }}
    />
  );
}
