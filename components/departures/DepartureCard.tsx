'use client';

import clsx from 'clsx';
import { PlatformAlertButton } from './PlatformAlertButton';
import Link from 'next/link';
import { ModeIcon, badgeColors } from '@/components/ui/primitives';
import { formatClockParts, formatCountdown } from '@/lib/transit/time';
import { useTicker } from '@/lib/client/useTransit';
import { directionColors, type Compass, type DirectionTone } from './directions';
import type { Departure } from '@/lib/transit/types';

/**
 * A departure as a boarding pass.
 *
 * One rule decides the colour of everything on it: the spine belongs to the
 * direction, and the line is only a small pill in the body. Direction is what a
 * rider scans a board for, and it is the one thing that differs between two
 * neighbouring Lakeshore West cards — so it gets the biggest block. Giving the
 * spine to the line instead painted every LW card the same burgundy and forced
 * that burgundy to sit beside blue and purple.
 *
 * The platform is torn off into a stub behind a perforation with real punched
 * notches, which is what makes it read as a ticket rather than a dashed border.
 */
export function DepartureCard({
  departure,
  compact = false,
  tone,
  heading,
}: {
  departure: Departure;
  compact?: boolean;
  /** Which way it is heading; colours the spine, wash and platform stub. */
  tone?: DirectionTone;
  /** Compass heading, drawn as an arrow so colour is never the only signal. */
  heading?: Compass;
}) {
  const now = useTicker(15_000);
  const {
    scheduledTime,
    estimatedTime,
    arrivalTime,
    arrivalEstimated,
    arrivalStopName,
    delaySeconds,
    cancelled,
    vehicleType,
    platform,
    expectedPlatform,
    platformEta,
    platformNote,
    routeCode,
    serviceCode,
    routeColor,
    destination,
    routeName,
    realtime,
    express,
  } = departure;

  const delayMinutes = delaySeconds != null ? Math.round(delaySeconds / 60) : null;
  const late = !cancelled && delayMinutes != null && delayMinutes >= 1;
  const early = !cancelled && delayMinutes != null && delayMinutes <= -2;
  const effective = cancelled ? scheduledTime : (estimatedTime ?? scheduledTime);
  const departed = !cancelled && new Date(effective ?? 0).getTime() < now;

  const depart = formatClockParts(scheduledTime);
  const actual = formatClockParts(estimatedTime);
  const arrive = formatClockParts(late ? (arrivalEstimated ?? arrivalTime) : arrivalTime);
  const countdown = formatCountdown(effective, now);

  const isBus = vehicleType === 'bus';
  // Only the compass tones own the spine. Groups without a compass word (buses,
  // a terminus split by line) keep the service's own colour.
  const directional = !cancelled && (tone === 'a' || tone === 'b');
  const dir = tone && !cancelled ? directionColors(tone) : null;

  const spine = cancelled
    ? 'var(--color-ink-500)'
    : directional
      ? `var(--spine-${tone})`
      : (routeColor ?? 'var(--accent)');

  const statusColor = cancelled
    ? 'var(--status-disruption-fg)'
    : late || early
      ? 'var(--status-delayed-fg)'
      : realtime
        ? 'var(--status-live-fg)'
        : 'var(--fg-muted)';

  const statusLabel = cancelled
    ? 'Cancelled'
    : late
      ? `${delayMinutes} min late`
      : early
        ? `${Math.abs(delayMinutes ?? 0)} min early`
        : realtime
          ? 'On time'
          : 'Scheduled';

  const platformValue = platform?.replace(/^platforms?\s*/i, '');
  const hasPlatform = Boolean(platformValue);

  // A light wash only: the spine carries the colour, so the body stays calm and
  // the card reads as one family instead of a colour block with a coloured box.
  const cardStyle = dir
    ? {
        background: `color-mix(in oklab, ${dir.fg} 5%, var(--bg-elevated))`,
        borderColor: dir.border,
      }
    : undefined;

  const body = (
    <>
      {/* Spine: a slim bar in the direction's colour. A wide striped block read
          as hazard tape and took a sixth of the card from the words that matter. */}
      <span aria-hidden className="w-[6px] shrink-0 rounded-l-[15px]" style={{ background: spine }} />

      {/*
        Body: three lines, not four. The departure time and the line's identity
        share the top line — the time stays the biggest thing on the card and
        still sits at a fixed left edge, so a column of them scans straight
        down, while the badge rides the right of the same line instead of
        costing a line of its own. The route's full name moves to the status
        line, where it is context rather than a heading: the badge already says
        which line this is.

        The destination keeps the full width of the body. Pulling the time out
        into its own column would have aligned it more strictly and taken
        seventy pixels off names like "Durham College Oshawa GO", which is a
        bad trade on a 375px phone.
      */}
      <span className="min-w-0 flex-1 px-3.5 py-2.5 @max-[340px]:px-2.5">
        <span className="flex items-baseline gap-2">
          <span
            className={clsx(
              'tabular text-[25px] leading-none font-semibold tracking-tight @max-[340px]:text-[20px]',
              cancelled && 'text-[var(--fg-faint)] line-through',
            )}
          >
            {depart.time}
          </span>
          <span className="text-micro font-semibold tracking-wide text-faint uppercase">
            {depart.suffix.replace(/\./g, '')}
          </span>
          {late ? (
            <span className="tabular text-small leading-none font-bold text-warn-500">
              {actual.time}
            </span>
          ) : null}

          <span className="ml-auto flex shrink-0 items-center gap-1.5 self-center">
            {heading && directional ? <Arrow heading={heading} /> : null}
            <ModeIcon type={vehicleType} className="size-4 shrink-0 text-[var(--fg-faint)]" />
            {express ? (
              <span
                className="shrink-0 rounded px-1 py-px text-[9px] font-bold tracking-wide uppercase"
                style={{ background: 'var(--express-surface)', color: 'var(--express)' }}
              >
                Exp
              </span>
            ) : null}
            <span
              className="inline-flex h-[18px] shrink-0 items-center rounded px-1.5 text-mini leading-none font-bold whitespace-nowrap"
              style={badgeColors(cancelled ? '#6e7768' : (routeColor ?? '#565e51'))}
            >
              {serviceCode ?? routeCode}
            </span>
          </span>
        </span>

        <span className="mt-1.5 block truncate text-body leading-tight font-semibold @max-[340px]:text-small">
          {arrivalStopName ?? destination ?? routeName}
        </span>

        <span className="mt-1 flex items-center gap-1.5 text-tiny text-muted">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: statusColor }}
          />
          <span className="shrink-0 font-medium whitespace-nowrap" style={{ color: statusColor }}>
            {statusLabel}
          </span>
          <span className="min-w-0 truncate text-faint">
            {routeName ? `· ${routeName}` : ''}
            {arrivalTime && !cancelled ? ` · arrives ${arrive.time}` : ''}
          </span>
        </span>
      </span>

      {/* Stub: the platform, torn off.

          It carries its own ground now. A platform number is the single piece
          of a departure a rider reads off a board and then walks on, and it
          was being drawn in the direction's colour — which for a bus is the
          neutral grey, so it came out the same ink as the destination beside
          it. The tag is cool and sign-like in both themes and is the only
          thing in the app wearing that blue, so the eye finds it without
          reading. The direction still speaks through the spine and the wash. */}
      <span
        className="flex w-[80px] shrink-0 flex-col items-center justify-between rounded-r-[15px] px-1.5 py-3 @max-[340px]:w-[68px]"
        style={hasPlatform ? { background: 'var(--platform-bg)' } : undefined}
      >
        <span
          className="text-[8px] font-bold tracking-[0.12em] uppercase"
          style={{ color: hasPlatform ? 'var(--platform-label)' : 'var(--fg-faint)' }}
        >
          {expectedPlatform && !platformValue ? 'Expected' : 'Platform'}
        </span>

        <span className="flex flex-1 flex-col items-center justify-center gap-0.5">
        {platformValue ? (
          <span
            style={{ color: 'var(--platform-fg)' }}
            className={clsx(
              'tabular leading-none font-bold',
              platformValue.length > 2
                ? 'text-body @max-[340px]:text-small'
                : 'text-[26px] @max-[340px]:text-[21px]',
            )}
          >
            {platformValue}
          </span>
        ) : (
          <>
            {expectedPlatform ? (
              <>
                {/* Dashed and unfilled: a provisional number, deliberately
                    unlike the solid one GO has actually committed to. */}
                <span
                  className="tabular rounded-md border-[1.5px] border-dashed px-1.5 py-0.5 text-body leading-none font-semibold @max-[340px]:text-small"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--fg-muted)' }}
                >
                  {expectedPlatform.replace(/^platforms?\s*/i, '')}
                </span>
                <span className="text-center text-[7.5px] leading-tight tracking-wide text-faint uppercase">
                  not yet
                </span>
              </>
            ) : (
              <>
                {/* How long until GO calls it, worked out from how far ahead
                    this station is posting right now. The board itself is the
                    only evidence, so when it offers none this says nothing —
                    and it takes the number's place rather than hanging under a
                    dash, because it is the answer, not a footnote to one. */}
                {platformEta ? (
                  <>
                    <span className="tabular text-body leading-none font-bold text-[var(--fg-muted)] @max-[340px]:text-small">
                      ~{Math.max(1, Math.round((Date.parse(platformEta) - now) / 60_000))} min
                    </span>
                    <span className="text-center text-[7.5px] leading-tight tracking-wide text-faint uppercase">
                      until posted
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[20px] leading-none font-bold text-faint">&mdash;</span>
                    {platformNote ? (
                      <span className="text-center text-[8px] leading-tight text-faint">soon</span>
                    ) : null}
                  </>
                )}
              </>
            )}
            {/* No platform yet is exactly when a rider wants telling. */}
            {!cancelled && !departed && departure.tripNumber ? (
              <PlatformAlertButton
                target={{
                  stopId: departure.stopId,
                  stopName: departure.stopName,
                  tripId: departure.tripId,
                  tripNumber: departure.tripNumber,
                  departsAt: departure.estimatedTime ?? departure.scheduledTime,
                }}
              />
            ) : null}
          </>
        )}
        </span>

        {!cancelled && countdown ? (
          /* On a posted platform the countdown wears the tag's own ink: the
             status is already said twice on the left, and a green number on
             the blue tag made the tag look like two things at once. */
          <span
            className="tabular text-mini leading-none font-bold whitespace-nowrap"
            style={{
              color: departed
                ? 'var(--fg-faint)'
                : hasPlatform
                  ? 'var(--platform-label)'
                  : statusColor,
            }}
          >
            {countdown}
          </span>
        ) : null}
      </span>
    </>
  );

  const className = clsx(
    '@container relative flex w-full items-stretch rounded-2xl border text-left hairline',
    'bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]',
    'transition-[transform,box-shadow] duration-150',
    'hover:-translate-y-px hover:shadow-lg active:translate-y-0 active:scale-[0.997]',
    compact && 'text-small',
    cancelled && 'opacity-90',
    departed && 'opacity-55',
  );

  const label = `${depart.time} ${depart.suffix} ${serviceCode ?? routeCode ?? ''} ${
    heading ? `${heading}bound ` : ''
  }to ${arrivalStopName ?? destination ?? ''}, ${statusLabel}${
    platform
      ? `, ${platform}`
      : expectedPlatform
        ? `, ${expectedPlatform} expected, not yet confirmed`
        : platformEta
          ? `, platform expected to be posted in about ${Math.max(
              1,
              Math.round((Date.parse(platformEta) - now) / 60_000),
            )} minutes`
          : ''
  }`;

  if (!departure.tripId) {
    return (
      <div className={className} style={cardStyle} aria-label={label}>
        {body}
      </div>
    );
  }

  return (
    <Link
      href={`/trips/${encodeURIComponent(departure.tripId)}`}
      className={className}
      style={cardStyle}
      aria-label={label}
    >
      {body}
    </Link>
  );
}

/** A crisp SVG arrow — the glyph arrows render thin and uneven across fonts. */
function Arrow({ heading }: { heading: Compass }) {
  const rotate: Record<Compass, number> = { east: 0, south: 90, west: 180, north: 270 };
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-7"
      fill="none"
      aria-hidden
      style={{ transform: `rotate(${rotate[heading]}deg)` }}
    >
      <path
        d="M4.5 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
