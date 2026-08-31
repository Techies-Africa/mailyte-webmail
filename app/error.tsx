'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * What a reader sees when something in the webmail throws.
 *
 * Without this file Next renders its own page -- "This page couldn't load.
 * Reload to try again, or go back." -- which names neither the error nor
 * where it happened. A report from a phone is then a screenshot of a black
 * screen, and for a client-side throw the server logs hold nothing, so the
 * cause has to be reconstructed by reading code. Two of those cost an
 * afternoon (a bare `toLocaleString()` on a device with a malformed default
 * locale -- see lib/webmail/dates.ts).
 *
 * This one prints the error, Next's digest when there is one, and the
 * browser and language, so a screenshot IS the bug report. "Try again"
 * re-renders the failed segment (Next's `reset`), which is enough for a
 * transient fault and cheaper than a full reload.
 */
export default function WebmailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Read after mount: navigator is client-only, and an error boundary can be
  // rendered on the server for a server-side throw.
  const [environment, setEnvironment] = useState('');

  useEffect(() => {
    console.error(error);
    setEnvironment(`${navigator.userAgent}\nlanguage: ${navigator.language}`);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900 px-6">
      <div className="w-full max-w-md">
        <AlertTriangle size={32} className="text-amber-500 mb-4" aria-hidden="true" />
        <h1 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          Something went wrong
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          This part of the webmail hit an error it could not recover from. The details below are
          what to send when reporting it.
        </p>

        <pre
          role="alert"
          className="mt-4 whitespace-pre-wrap break-words rounded-md bg-gray-100 dark:bg-gray-800 p-3 font-mono text-xs text-gray-800 dark:text-gray-200"
        >
          {`${error.name}: ${error.message}`}
          {error.digest ? `\ndigest: ${error.digest}` : ''}
          {environment ? `\n\n${environment}` : ''}
        </pre>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={reset}
            className="px-4 py-1.5 text-sm rounded-md bg-primary text-black"
          >
            Try again
          </button>
          <a
            href="/"
            className="px-4 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300"
          >
            Back to mail
          </a>
        </div>
      </div>
    </div>
  );
}
