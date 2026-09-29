'use client';

import { usePlatformAlert, type PlatformAlertTarget } from '@/lib/client/platformAlert';

/**
 * Asks the server to push a notification the moment this trip's platform is
 * posted. Only worth offering while the platform is still unknown, which is
 * also the only time a rider cares.
 */
export function PlatformAlertButton({ target }: { target: PlatformAlertTarget }) {
  const { state, durable, watch, stop } = usePlatformAlert(target);

  if (state === 'unsupported') return null;

  const watching = state === 'watching';
  const label = watching
    ? `Stop waiting for the platform for train ${target.tripNumber}`
    : `Tell me when the platform for train ${target.tripNumber} is posted`;

  return (
    <span className="mt-1 flex flex-col items-center gap-0.5">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(event) => {
          // The card is a link to the trip; the bell is not.
          event.preventDefault();
          event.stopPropagation();
          void (watching ? stop() : watch());
        }}
        disabled={state === 'asking' || state === 'blocked'}
        className={
          watching
            ? 'grid size-7 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)]'
            : 'grid size-7 place-items-center rounded-full border text-[var(--fg-faint)] hairline'
        }
      >
        <BellIcon filled={watching} />
      </button>
      {watching && !durable ? (
        <span className="text-center text-[7.5px] leading-tight text-[var(--color-warn-500)]">
          not saved
        </span>
      ) : null}
      {state === 'blocked' ? (
        <span className="text-center text-[7.5px] leading-tight text-faint">blocked</span>
      ) : null}
    </span>
  );
}

function BellIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" aria-hidden>
      <path
        d="M12 3a6 6 0 0 0-6 6v3.6L4.6 15.4A1 1 0 0 0 5.5 17h13a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
        fillOpacity={filled ? 0.25 : 0}
      />
      <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
