'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  type FollowedLine,
  type LinkReport,
  type PushState,
  checkLinked,
  deviceLabel,
  disablePush,
  enablePush,
  followedLines,
  pushSupport,
  refreshDevice,
  relink,
  requestServerTest,
  showTestNotification,
  unfollowLine,
} from '@/lib/client/pushDevice';

/**
 * Notifications, and whether they will actually arrive.
 *
 * Modelled on Settle's, which stays dependable because it answers a question
 * most apps never ask: not "are notifications allowed" but "can the server
 * reach this phone". Those are different, and the gap between them is where
 * alerts quietly go missing — permission granted, a push address the browser
 * renewed months ago, and a server still writing to the old one.
 *
 * So every state here says what to do next, and the check below asks the
 * server directly, with a repair button when the answer is no.
 */
export function NotificationSettings() {
  const [state, setState] = useState<PushState>('unknown');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<LinkReport | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lines, setLines] = useState<FollowedLine[] | null>(null);
  const device = typeof navigator === 'undefined' ? 'device' : deviceLabel();

  const verify = useCallback(async (next: PushState) => {
    setState(next);
    if (next !== 'on') {
      setLink(null);
      setLines(null);
      return;
    }
    setLink(await checkLinked());
    setLines(await followedLines());
  }, []);

  useEffect(() => {
    const initial = pushSupport();
    if (initial !== 'off') {
      setState(initial);
      return;
    }
    refreshDevice().then(verify);
  }, [verify]);

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    const result = await enablePush();
    if (result.error) setNote(`Could not turn them on: ${result.error}`);
    else if (result.state === 'on' && !result.durable) {
      setNote('This server cannot remember the registration, so alerts will not survive.');
    }
    await verify(result.state);
    setBusy(false);
  };

  const turnOff = async () => {
    setBusy(true);
    await disablePush();
    setState('off');
    setLink(null);
    setLines(null);
    setNote(null);
    setBusy(false);
  };

  const repair = async () => {
    setBusy(true);
    const ok = await relink();
    setNote(ok ? null : 'Could not link this device. Turn notifications off and on again.');
    setLink(await checkLinked());
    setBusy(false);
  };

  const test = async () => {
    try {
      await showTestNotification();
      setNote(null);
    } catch (err) {
      setNote(`Could not show one: ${err instanceof Error ? err.message : 'try again'}`);
    }
  };

  const serverTest = async () => {
    setBusy(true);
    setNote(null);
    const result = await requestServerTest();
    setNote(
      result.ok
        ? 'On its way. Close GO Tracker now — it should arrive within a minute. If it does, alerts will reach you the same way.'
        : `Could not ask for one: ${result.error ?? 'try again'}`,
    );
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <BellGlyph on={state === 'on'} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{headline(state, device)}</p>
          <p className="mt-0.5 text-small text-muted">{explain(state, device)}</p>
        </div>
      </div>

      {state === 'on' ? (
        <>
          {/* The honest status line. "Allowed" is not "will arrive". */}
          <p
            className="flex items-start gap-2 rounded-xl px-3 py-2 text-small"
            style={
              link == null
                ? { background: 'var(--bg-sunken)', color: 'var(--fg-muted)' }
                : link.linked
                  ? { background: 'var(--status-live-bg)', color: 'var(--status-live-fg)' }
                  : { background: 'var(--status-delayed-bg)', color: 'var(--status-delayed-fg)' }
            }
          >
            <span aria-hidden className="font-bold">
              {link == null ? '…' : link.linked ? '✓' : '!'}
            </span>
            <span>
              {link == null
                ? `Checking this ${device} is registered…`
                : link.linked
                  ? `Registered. GO Tracker can reach this ${device} with the app closed.`
                  : (link.error ??
                    `Not registered, so alerts cannot reach this ${device}.`)}
            </span>
          </p>

          {link && !link.linked ? (
            <button
              type="button"
              onClick={repair}
              disabled={busy}
              className="flex min-h-11 w-full items-center justify-center rounded-xl text-ui font-bold disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              Register this {device}
            </button>
          ) : null}

          {link?.linked && !link.durable ? (
            <p className="rounded-xl bg-[var(--bg-sunken)] px-3 py-2 text-small text-muted">
              This server has no shared store, so the registration will not outlive a restart.
            </p>
          ) : null}

          {/*
            Everything that can reach this phone from now on, and nothing
            else. Platform alerts die with their train and a trip's alerts end
            with the trip, so a followed line is the only standing claim on a
            phone — which makes it the only one that needs a way out here.
          */}
          <div>
            <p className="mb-1.5 text-mini font-semibold tracking-wide text-faint uppercase">
              You will be told about
            </p>
            <ul className="space-y-1">
              <li className="flex items-start gap-2 text-small text-muted">
                <span aria-hidden>·</span>
                <span>Platforms and stops you ask for. Each ends with that train.</span>
              </li>
              {lines === null ? null : lines.length === 0 ? (
                <li className="flex items-start gap-2 text-small text-muted">
                  <span aria-hidden>·</span>
                  <span>
                    No lines followed. Open a line and turn on big-delay alerts to add one.
                  </span>
                </li>
              ) : (
                lines.map((line) => (
                  <li
                    key={line.routeId}
                    className="flex min-h-11 items-center gap-2 rounded-xl px-2.5"
                    style={{ background: 'var(--bg-sunken)' }}
                  >
                    <span className="min-w-0 flex-1 truncate text-small">
                      <span className="font-semibold">{line.routeName}</span>
                      <span className="text-muted"> · big delays</span>
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await unfollowLine(line.routeId);
                        setLines(await followedLines());
                      }}
                      className="shrink-0 rounded-lg px-2 py-1 text-mini font-semibold text-[var(--fg-muted)]"
                      aria-label={`Stop following ${line.routeName}`}
                    >
                      Remove
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          {/*
            The test that answers the actual question. The local one below
            only asks the page to draw a notification — it never touches the
            server, the signing key, the push service or the sleeping service
            worker, which is every part that can really be broken.
          */}
          <button
            type="button"
            onClick={serverTest}
            disabled={busy}
            className="flex min-h-12 w-full flex-col items-center justify-center rounded-xl border text-ui font-bold hairline disabled:opacity-50"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            Send a real test from the server
            <span className="text-mini font-medium text-muted">
              Arrives within a minute — close the app and wait
            </span>
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={test}
              className="flex min-h-11 flex-1 items-center justify-center rounded-xl border text-ui font-semibold hairline bg-[var(--bg-elevated)]"
            >
              Test on screen
            </button>
            <button
              type="button"
              onClick={turnOff}
              disabled={busy}
              className="flex min-h-11 flex-1 items-center justify-center rounded-xl border text-ui font-semibold text-[var(--fg-muted)] hairline disabled:opacity-50"
            >
              Turn off
            </button>
          </div>
        </>
      ) : null}

      {state === 'off' ? (
        <button
          type="button"
          onClick={turnOn}
          disabled={busy}
          className="flex min-h-12 w-full items-center justify-center rounded-xl text-ui font-bold disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          Turn on notifications
        </button>
      ) : null}

      {state === 'ios-install' ? <Steps steps={IOS_INSTALL} /> : null}
      {state === 'denied' ? <Steps steps={isApple(device) ? IOS_BLOCKED : DESKTOP_BLOCKED} /> : null}

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

const isApple = (device: string) => device === 'iPhone' || device === 'iPad';

function headline(state: PushState, device: string): string {
  switch (state) {
    case 'on':
      return `On for this ${device}`;
    case 'off':
      return 'Know your platform the moment it is posted';
    case 'ios-install':
      return 'Add GO Tracker to your Home Screen first';
    case 'denied':
      return `Blocked in this ${device}'s settings`;
    case 'unsupported':
      return 'This browser cannot show notifications';
    default:
      return 'Checking…';
  }
}

function explain(state: PushState, device: string): string {
  switch (state) {
    case 'on':
      return 'Platform and arrival alerts arrive with the app closed and the screen off.';
    case 'off':
      return `GO holds a platform back until a few minutes before departure — exactly when your ${device} is in a pocket.`;
    case 'ios-install':
      return 'On iPhone, notifications work once the app is on your Home Screen. Safari gives an ordinary tab none at all.';
    case 'denied':
      return 'Notifications have to be allowed again before alerts can arrive.';
    case 'unsupported':
      return 'On Android use Chrome; on iPhone add GO Tracker to the Home Screen from Safari.';
    default:
      return 'One moment.';
  }
}

const IOS_INSTALL = [
  'In Safari, tap Share',
  'Choose Add to Home Screen, then Add',
  'Open GO Tracker from your Home Screen',
  'Come back here and tap Turn on',
];
const IOS_BLOCKED = [
  'Open Settings, then Notifications',
  'Find GO Tracker and turn on Allow Notifications',
  'Come back and reopen GO Tracker',
];
const DESKTOP_BLOCKED = [
  'Tap the icon at the left of the address bar',
  'Open Permissions or Site settings',
  'Set Notifications to Allow, then reload',
];

/** Every blocked state gets the way out, not just the bad news. */
function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={step} className="flex items-start gap-2.5 text-small">
          <span
            aria-hidden
            className="grid size-5 shrink-0 place-items-center rounded-full text-mini font-bold"
            style={{ background: 'var(--bg-sunken)', color: 'var(--fg-muted)' }}
          >
            {i + 1}
          </span>
          <span className="text-muted">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function BellGlyph({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-full"
      style={
        on
          ? { background: 'var(--status-live-bg)', color: 'var(--status-live-fg)' }
          : { background: 'var(--bg-sunken)', color: 'var(--fg-muted)' }
      }
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
        <path
          d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M10.3 19a2 2 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}
