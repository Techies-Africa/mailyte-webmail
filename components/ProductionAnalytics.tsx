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

  // Never on the auth pages. /login is the one page rendered per request
  // (it reads the Turnstile site key at run time), so with the tracking ids
  // set it would otherwise be the ONLY page that ever loaded this script --
  // every session recorded would be a sign-in screen and nothing else, which
  // is worse than no data at all. Clarity records what is on screen, and
  // these are the two pages where a password is typed.
  var path = window.location.pathname.replace(/\\/+$/, '');
  if (path === '/login' || path === '/change-password') return;

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
})();
`;
}

export function ProductionAnalytics() {
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
