'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { ModeIcon } from '@/components/ui/primitives';
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
    ? 'var(--color-alert-500)'
    : late
      ? 'var(--color-warn-500)'
      : realtime && !early
        ? 'var(--color-signal-500)'
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
      {/* Spine: direction (or, without one, the service's colour). */}
      <span
        aria-hidden
        className="relative flex w-[46px] shrink-0 flex-col items-center justify-center gap-2 rounded-l-[15px] text-white @max-[340px]:w-[40px]"
        style={{
          background: `${
            // Stripes mark a bus even where a colour-blind rider can't tell hues apart.
            isBus
              ? 'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.14) 0 5px, transparent 5px 10px), '
              : ''
          }linear-gradient(170deg, ${spine}, color-mix(in oklab, ${spine} 74%, #000))`,
        }}
      >
        {heading && directional ? <Arrow heading={heading} /> : null}
        <ModeIcon
          type={vehicleType}
          className={clsx('opacity-90', heading && directional ? 'size-4' : 'size-6')}
        />
        {/* A hairline of light along the fold, so the spine reads as raised. */}
        <span className="absolute inset-y-0 right-0 w-px bg-white/25" />
      </span>

      {/* Body: which service, when it leaves, where it goes. */}
      <span className="min-w-0 flex-1 px-3.5 py-3 @max-[340px]:px-2.5">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-flex h-[18px] shrink-0 items-center rounded px-1.5 text-[11px] leading-none font-bold whitespace-nowrap text-white"
            style={{ background: cancelled ? 'var(--color-ink-500)' : (routeColor ?? 'var(--color-ink-600)') }}
          >
            {serviceCode ?? routeCode}
          </span>
          {express ? (
            <span
              className="shrink-0 rounded px-1 py-px text-[9px] font-bold tracking-wide uppercase"
              style={{ background: 'var(--express-surface)', color: 'var(--express)' }}
            >
              Exp
            </span>
          ) : null}
          <span className="min-w-0 truncate text-[12px] text-faint">{routeName}</span>
        </span>

        <span className="mt-2 flex items-baseline gap-2">
          <span
            className={clsx(
              'tabular text-[25px] leading-none font-semibold tracking-tight @max-[340px]:text-[20px]',
              cancelled && 'text-[var(--fg-faint)] line-through',
            )}
          >
            {depart.time}
          </span>
          <span className="text-[10px] font-semibold tracking-wide text-faint uppercase">
            {depart.suffix.replace(/\./g, '')}
          </span>
          {late ? (
            <span className="tabular text-[13px] leading-none font-bold text-warn-500">
              {actual.time}
            </span>
          ) : null}
        </span>

        <span className="mt-1.5 block truncate text-[15px] leading-tight font-semibold @max-[340px]:text-[13.5px]">
          {arrivalStopName ?? destination ?? routeName}
        </span>

        <span className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: statusColor }}
          />
          <span className="font-medium whitespace-nowrap" style={{ color: statusColor }}>
            {statusLabel}
          </span>
          {arrivalTime && !cancelled ? (
            <span className="min-w-0 truncate text-faint">· arrives {arrive.time}</span>
          ) : null}
        </span>
      </span>

      {/* Perforation: punched through the card edges, not just a dashed rule. */}
      <span
        aria-hidden
        className="relative w-0 border-l border-dashed"
        style={{ borderColor: 'var(--border-strong)' }}
      >
        <span
          className="absolute -top-[7px] -left-[6px] size-3 rounded-full border"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        />
        <span
          className="absolute -bottom-[7px] -left-[6px] size-3 rounded-full border"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
        />
      </span>

      {/* Stub: the platform, torn off. */}
      <span
        className="flex w-[72px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-r-[15px] px-1.5 py-3 @max-[340px]:w-[56px]"
        style={dir ? { background: `color-mix(in oklab, ${dir.fg} 12%, transparent)` } : undefined}
      >
        <span
          className="text-[8px] font-bold tracking-[0.12em] uppercase"
          style={{ color: platformValue && dir ? dir.fg : 'var(--fg-faint)', opacity: platformValue ? 0.85 : 1 }}
        >
          Platform
        </span>

        {platformValue ? (
          <span
            style={dir ? { color: dir.fg } : undefined}
            className={clsx(
              'tabular leading-none font-bold',
              platformValue.length > 2
                ? 'text-[15px] @max-[340px]:text-[13px]'
                : 'text-[26px] @max-[340px]:text-[21px]',
            )}
          >
            {platformValue}
          </span>
        ) : (
          <>
            <span className="text-[20px] leading-none font-bold text-faint">&mdash;</span>
            {platformNote ? (
              <span className="text-center text-[8px] leading-tight text-faint">soon</span>
            ) : null}
          </>
        )}

        {!cancelled && countdown ? (
          <span
            className="tabular mt-1.5 text-[11px] leading-none font-bold whitespace-nowrap"
            style={{ color: departed ? 'var(--fg-faint)' : statusColor }}
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
    compact && 'text-[13px]',
    cancelled && 'opacity-90',
    departed && 'opacity-55',
  );

  const label = `${depart.time} ${depart.suffix} ${serviceCode ?? routeCode ?? ''} ${
    heading ? `${heading}bound ` : ''
  }to ${arrivalStopName ?? destination ?? ''}, ${statusLabel}${platform ? `, ${platform}` : ''}`;

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
