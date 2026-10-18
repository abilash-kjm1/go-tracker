'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { enablePush, pushSupport } from '@/lib/client/pushDevice';

type State = 'checking' | 'off' | 'on' | 'blocked' | 'unavailable' | 'busy';

/**
 * "Tell me when this line is in trouble."
 *
 * Deliberately the quietest alert in the app. It fires when a service on the
 * line is a quarter of an hour down — not when one is two minutes late, which
 * is the threshold the alerts page uses and which sixteen lines were meeting
 * at three in the morning. And it fires once per incident, not once a minute
 * for as long as it lasts.
 */
export function LineAlertToggle({
  routeId,
  routeName,
}: {
  routeId: string;
  routeName: string;
}) {
  const [state, setState] = useState<State>('checking');
  const [note, setNote] = useState<string | null>(null);

  const subscription = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const support = pushSupport();
      // Blocked, or an iPhone not yet on the Home Screen, is a state with a
      // way out — so it says so and points at it. Only a browser that can
      // never do this at all is passed over in silence.
      if (support === 'unsupported') {
        if (!cancelled) setState('unavailable');
        return;
      }
      if (support === 'denied' || support === 'ios-install') {
        if (!cancelled) setState('blocked');
        return;
      }
      try {
        const sub = await subscription();
        if (!sub) {
          if (!cancelled) setState('off');
          return;
        }
        const response = await fetch(
          `/api/push/lines?endpoint=${encodeURIComponent(sub.endpoint)}`,
        );
        const body = (await response.json()) as {
          data?: { lines?: Array<{ routeId: string }> };
        };
        const following = body.data?.lines?.some((l) => l.routeId === routeId) ?? false;
        if (!cancelled) setState(following ? 'on' : 'off');
      } catch {
        if (!cancelled) setState('off');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeId, subscription]);

  const toggle = async () => {
    const wasOn = state === 'on';
    setState('busy');
    setNote(null);
    try {
      let sub = await subscription();
      if (!sub) {
        // Permission is asked for here, inside the tap, which is the only
        // place Safari will honour it.
        const result = await enablePush();
        if (result.state !== 'on') {
          setState(result.state === 'denied' ? 'blocked' : 'off');
          setNote(
            result.state === 'denied'
              ? 'Notifications are blocked. Allow them in your settings, then try again.'
              : 'Notifications were not turned on.',
          );
          return;
        }
        sub = await subscription();
        if (!sub) {
          setState('off');
          setNote('Could not set this device up. Try again.');
          return;
        }
      }

      const response = wasOn
        ? await fetch('/api/push/lines', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint, routeId }),
          })
        : await fetch('/api/push/lines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscription: sub.toJSON(),
              routeId,
              routeName,
            }),
          });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setState(wasOn ? 'on' : 'off');
        setNote(body?.error ?? 'That did not work. Try again.');
        return;
      }
      setState(wasOn ? 'off' : 'on');
    } catch {
      setState(wasOn ? 'on' : 'off');
      setNote('That did not work. Try again.');
    }
  };

  if (state === 'unavailable') return null;

  if (state === 'blocked') {
    return (
      <Link
        href="/more"
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 hairline bg-[var(--bg-elevated)]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-ui font-semibold">Alerts for this line</span>
          <span className="block text-small text-muted">
            Turn notifications on in Settings to be told about big delays here.
          </span>
        </span>
        <span aria-hidden className="text-[var(--fg-faint)]">
          ›
        </span>
      </Link>
    );
  }

  const on = state === 'on';
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        disabled={state === 'checking' || state === 'busy'}
        aria-pressed={on}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 text-left transition-colors hairline disabled:opacity-60"
        style={
          on
            ? { background: 'var(--status-live-bg)', borderColor: 'transparent' }
            : { background: 'var(--bg-elevated)' }
        }
      >
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={
            on
              ? { background: 'var(--status-live-fg)', color: 'var(--status-live-bg)' }
              : { background: 'var(--bg-sunken)', color: 'var(--fg-muted)' }
          }
        >
          <svg viewBox="0 0 24 24" className="size-4.5" fill="none" aria-hidden>
            <path
              d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path
              d="M10.3 19a2 2 0 0 0 3.4 0"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block text-ui font-semibold"
            style={on ? { color: 'var(--status-live-fg)' } : undefined}
          >
            {on ? 'Following this line' : 'Tell me about big delays'}
          </span>
          <span
            className="block text-small"
            style={{ color: on ? 'var(--status-live-fg)' : 'var(--fg-muted)' }}
          >
            {state === 'checking'
              ? 'Checking…'
              : on
                ? 'One notification when a service runs 15 minutes or more late.'
                : 'Only when a service is 15 minutes or more late — never for a minor delay.'}
          </span>
        </span>
      </button>

      {note ? (
        <p
          role="alert"
          className="rounded-xl px-3 py-2 text-small"
          style={{ background: 'var(--status-delayed-bg)', color: 'var(--status-delayed-fg)' }}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
