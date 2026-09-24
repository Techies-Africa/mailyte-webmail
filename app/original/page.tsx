'use client';

/**
 * "Show original": the message exactly as the mail server holds it.
 *
 * What Gmail's page of the same name shows, in the same order -- the
 * identifying facts on top (Message-ID, date, sender, recipients, subject),
 * the authentication verdicts our own server wrote at ingress, then the raw
 * RFC 822 text with Copy and Download. Opens in its own tab from the
 * reader's menu, so the mailbox stays where it was.
 *
 * The raw text arrives as text/plain under a sandboxing CSP and is rendered
 * inside a <pre>, so nothing in it can be anything but characters.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Copy, Download, FileCode2 } from 'lucide-react';
import { BrandLockup } from '@/components/brand/BrandMark';
import Button from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Pill';
import { getMessage, rawMessageTextUrl, rawMessageUrl } from '@/lib/webmail/client';
import { toMessage } from '@/lib/webmail/adapters';
import { formatDateTime } from '@/lib/webmail/dates';
import type { WebmailMessage } from '@/components/webmail/types';

function Verdict({ label, value }: { label: string; value: string | null }) {
  const tone = value === 'pass' ? 'success' : value === 'fail' || value === 'softfail' ? 'danger' : 'neutral';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <StatusBadge tone={tone}>{value ?? 'not checked'}</StatusBadge>
    </span>
  );
}

function OriginalView() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id') ?? '';

  const [message, setMessage] = useState<WebmailMessage | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onUnauthorized = useCallback(() => router.replace('/login'), [router]);

  useEffect(() => {
    if (!id) {
      setError('No message was named.');
      return;
    }
    let cancelled = false;
    void getMessage(id, onUnauthorized).then((result) => {
      if (cancelled) return;
      if (result.success && result.data) setMessage(toMessage(result.data));
      else if (!result.success) setError(result.message);
    });
    void fetch(rawMessageTextUrl(id), { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string; msg?: string };
          throw new Error(body.message ?? body.msg ?? `The mail server answered ${res.status}`);
        }
        const text = await res.text();
        if (!cancelled) setRaw(text);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the original message.');
      });
    return () => {
      cancelled = true;
    };
  }, [id, onUnauthorized]);

  const copy = async () => {
    if (raw === null) return;
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy automatically. Select the text and copy it.');
    }
  };

  const auth = message?.provenance.authentication;

  return (
    <div className="min-h-screen bg-pane text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <a href="/" className="flex items-center" aria-label="Inbox">
          <BrandLockup height={22} tone="light" className="dark:hidden" />
          <BrandLockup height={22} tone="dark" className="hidden dark:block" />
        </a>
        <span className="h-5 w-px bg-border" />
        <h1 className="flex min-w-0 items-center gap-2 font-display text-[15px] font-bold tracking-tight">
          <FileCode2 size={16} className="shrink-0 text-muted-foreground" />
          <span className="truncate">Original message</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            icon={copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            onClick={() => void copy()}
            disabled={raw === null}
          >
            {copied ? 'Copied' : 'Copy to clipboard'}
          </Button>
          <a
            href={id ? rawMessageUrl(id) : '#'}
            download
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground hover:brightness-95"
          >
            <Download size={13} /> Download original
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {error && (
          <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {message && (
          <section className="mb-5 rounded-xl border border-border bg-card">
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 px-5 py-4 text-[13px]">
              <dt className="font-semibold text-muted-foreground">Message ID</dt>
              <dd className="break-all font-mono text-[12px]">{message.messageIdHeader ?? '—'}</dd>
              <dt className="font-semibold text-muted-foreground">Created</dt>
              <dd>{formatDateTime(message.timestamp)}</dd>
              <dt className="font-semibold text-muted-foreground">From</dt>
              <dd className="break-all">
                {message.from}
                {message.fromEmail && <span className="ml-1.5 font-mono text-[12px] text-muted-foreground">{message.fromEmail}</span>}
              </dd>
              <dt className="font-semibold text-muted-foreground">To</dt>
              <dd className="break-all font-mono text-[12px]">{message.to.map((p) => p.email).join(', ') || '—'}</dd>
              {message.cc.length > 0 && (
                <>
                  <dt className="font-semibold text-muted-foreground">Cc</dt>
                  <dd className="break-all font-mono text-[12px]">{message.cc.map((p) => p.email).join(', ')}</dd>
                </>
              )}
              <dt className="font-semibold text-muted-foreground">Subject</dt>
              <dd>{message.subject}</dd>
              {message.provenance.mailedBy && (
                <>
                  <dt className="font-semibold text-muted-foreground">Mailed by</dt>
                  <dd className="font-mono text-[12px]">{message.provenance.mailedBy}</dd>
                </>
              )}
              {message.provenance.signedBy && (
                <>
                  <dt className="font-semibold text-muted-foreground">Signed by</dt>
                  <dd className="font-mono text-[12px]">{message.provenance.signedBy}</dd>
                </>
              )}
              {message.provenance.security && (
                <>
                  <dt className="font-semibold text-muted-foreground">Security</dt>
                  <dd>
                    {message.provenance.security === 'tls'
                      ? 'Standard encryption (TLS) on the last hop'
                      : 'No encryption on the last hop'}
                  </dd>
                </>
              )}
              {auth && (
                <>
                  <dt className="font-semibold text-muted-foreground">Authentication</dt>
                  <dd className="flex flex-wrap gap-x-5 gap-y-1.5">
                    <Verdict label="SPF" value={auth.spf} />
                    <Verdict label="DKIM" value={auth.dkim} />
                    <Verdict label="DMARC" value={auth.dmarc} />
                  </dd>
                </>
              )}
            </dl>
          </section>
        )}

        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
            <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Raw message · RFC 822
            </span>
            {raw !== null && (
              <span className="text-[11px] text-muted-foreground">{raw.length.toLocaleString('en-US')} characters</span>
            )}
          </div>
          {raw === null && !error ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">Loading the original…</p>
          ) : (
            <pre className="thin-scroll max-h-[70vh] overflow-auto whitespace-pre-wrap break-all px-5 py-4 font-mono text-[12px] leading-[1.6]">
              {raw ?? ''}
            </pre>
          )}
        </section>

        <p className="mt-6">
          <a href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft size={14} /> Back to mail
          </a>
        </p>
      </main>
    </div>
  );
}

export default function OriginalMessagePage() {
  return (
    <Suspense fallback={null}>
      <OriginalView />
    </Suspense>
  );
}
