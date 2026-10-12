'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, Check, ListChecks, Send, ShieldCheck } from 'lucide-react';
import AuthLayout from '@/components/auth/AuthLayout';
import Button from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Field';
import { approveConnect, getConnectRequest, type ApiConnectRequest } from '@/lib/webmail/client';

/** Ticking one of these lets the app act, not just look: said under the box. */
const ACTS = new Set(['mail:send', 'mail:organize', 'calendar:write', 'contacts:write', 'settings:write']);

const trustCues = [
  { icon: ListChecks, label: 'You choose what it can do' },
  { icon: Send, label: 'Sending has a daily limit' },
  { icon: Ban, label: 'Disconnect any time in Settings' },
];

function backToSignIn(add: boolean) {
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?${add ? 'add=1&' : ''}next=${encodeURIComponent(here)}`);
}

/**
 * An AI app (ChatGPT, Claude) asking to act for this mailbox. It sent the
 * person here with an OAuth request; the mail server checks it, this page
 * shows what it asks for, and Allow returns them to the app with a code.
 *
 * Only reading is ticked to start. Nothing here can give the app more than it
 * asked for -- the mail server refuses that too.
 */
export default function ConnectApprove() {
  const [request, setRequest] = useState<ApiConnectRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const onUnauthorized = useCallback(() => backToSignIn(false), []);

  useEffect(() => {
    const query = window.location.search;
    if (!new URLSearchParams(query).get('client_id')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('This link is not complete. Go back to the app and start connecting again.');
      return;
    }
    void getConnectRequest(query, onUnauthorized).then((result) => {
      if (!result.success) {
        if (result.status !== 401) setError(result.message); // 401: on its way to sign in
        return;
      }
      if (!result.data) {
        setError('The request could not be read. Start connecting again from the app.');
        return;
      }
      setRequest(result.data);
      setChosen(new Set(result.data.scopes.filter((s) => s.default).map((s) => s.scope)));
    });
  }, [onUnauthorized]);

  const toggle = (scope: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });

  const allow = async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    const params = Object.fromEntries(new URLSearchParams(window.location.search));
    const result = await approveConnect(params, [...chosen], onUnauthorized);
    if (!result.success || !result.data) {
      setBusy(false);
      setError(result.success ? 'Something went wrong. Try again.' : result.message);
      return;
    }
    setLeaving(true);
    window.location.assign(result.data.redirect_to);
  };

  const decline = () => {
    if (!request) return;
    setLeaving(true);
    window.location.assign(request.decline_url);
  };

  const appName = request?.app.name ?? 'An app';

  return (
    <AuthLayout
      title={request ? `Connect ${appName}` : 'Connect an app'}
      description={
        request ? (
          <>
            {appName} wants to use <span data-clarity-mask="True">{request.mailbox}</span>.
          </>
        ) : (
          'An app wants to use your mailbox.'
        )
      }
      panelHeadline={
        <>
          Let an AI app
          <br />
          <span className="text-brand-gradient">help with your mail.</span>
        </>
      }
      panelDescription="It works with your mail the way you allow, and nothing more."
      trustCues={trustCues}
      footer={
        request && !leaving ? (
          <button type="button" onClick={() => backToSignIn(true)} className="font-semibold hover:text-foreground">
            Use another mailbox
          </button>
        ) : null
      }
    >
      {!request && !error && <p className="text-sm text-muted-foreground">Checking the request…</p>}

      {error && !request && (
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
          <a href="/" className="text-sm font-semibold text-primary hover:underline">
            Go to your mail
          </a>
        </div>
      )}

      {request && (
        <div className="space-y-5">
          <AppIdentity request={request} />

          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold text-foreground">It may</legend>
            <ul className="space-y-2.5">
              {request.scopes.map((s) => (
                <li key={s.scope}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <Checkbox
                      className="mt-0.5"
                      checked={chosen.has(s.scope)}
                      disabled={busy || leaving}
                      onChange={(e) => toggle(s.scope, e.target.checked)}
                    />
                    <span className="text-sm leading-snug text-foreground">
                      {s.label}
                      {s.scope === 'mail:send' && (
                        <span className="block text-xs text-muted-foreground">
                          Up to {request.daily_send_cap} emails a day. You can change this later.
                        </span>
                      )}
                      {ACTS.has(s.scope) && s.scope !== 'mail:send' && (
                        <span className="block text-xs text-muted-foreground">It can change things, not just look.</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          {[...chosen].some((s) => ACTS.has(s)) && (
            <p className="flex items-start gap-2 rounded-lg bg-warning/[0.12] px-3 py-2.5 text-xs leading-relaxed text-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Only allow this if you trust {appName}. Emails you receive could try to trick it.</span>
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="md" onClick={decline} disabled={busy || leaving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<Check size={14} />}
              busy={busy || leaving}
              disabled={chosen.size === 0}
              onClick={() => void allow()}
            >
              Allow
            </Button>
          </div>
          {chosen.size === 0 && <p className="text-right text-xs text-muted-foreground">Tick at least one.</p>}
        </div>
      )}
    </AuthLayout>
  );
}

function AppIdentity({ request }: { request: ApiConnectRequest }) {
  const { app } = request;
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-pane px-3.5 py-3">
      {app.logo_url && !logoFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- a remote logo the app named; not ours to optimise
        <img
          src={app.logo_url}
          alt=""
          referrerPolicy="no-referrer"
          className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain p-1"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-display text-lg font-bold text-primary">
          {app.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">{app.name}</div>
        {app.host && <div className="truncate font-mono text-[12px] text-muted-foreground">{app.host}</div>}
      </div>
      {app.verified ? (
        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-semibold text-success">
          <ShieldCheck size={13} /> Verified
        </span>
      ) : (
        <span className="ml-auto shrink-0 text-xs font-semibold text-warning">Not verified</span>
      )}
    </div>
  );
}
