'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Cloudflare Turnstile's "are you a person" check on the sign-in form. The
 * server half, and when it is on at all, is lib/webmail/turnstile.ts.
 *
 * Rendered explicitly, so the widget lives and dies with this component
 * instead of being found by class name once, when the script loads.
 * `onToken` gets each fresh token, and null when one expires or fails. A
 * token is good for one check, so the form bumps `resetSignal` after every
 * attempt and the widget fetches another.
 */
export default function Turnstile({
  siteKey,
  onToken,
  resetSignal,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  resetSignal: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  // The widget is rendered once and outlives the callback it was given.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const box = boxRef.current;
    const api = window.turnstile;
    if (!ready || !box || !api) return;
    const id = api.render(box, {
      sitekey: siteKey,
      action: 'login',
      theme: 'auto',
      size: 'flexible',
      callback: (token: string) => onTokenRef.current(token),
      'expired-callback': () => onTokenRef.current(null),
      'error-callback': () => onTokenRef.current(null),
    });
    widgetRef.current = id;
    return () => {
      api.remove(id);
      widgetRef.current = null;
    };
  }, [ready, siteKey]);

  // A repeat of the counter it already acted on is not a new request.
  const seenSignal = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === seenSignal.current) return;
    seenSignal.current = resetSignal;
    onTokenRef.current(null);
    if (widgetRef.current) window.turnstile?.reset(widgetRef.current);
  }, [resetSignal]);

  return (
    <>
      {/* onReady covers every mount once the script is in; onLoad covers a
          remount while it is still loading, which onReady misses. */}
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
        onLoad={() => setReady(true)}
      />
      {/* 65px: the widget's own height, held so the button below does not jump when it appears. */}
      <div ref={boxRef} className="min-h-[65px]" />
    </>
  );
}
