'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { SearchIcon } from '@/components/search/SearchOverlay';
import type { Phase } from './phase';

/**
 * The home hero, in GO's own colours: a green card with a live network diagram
 * behind it (every line in its colour, running into Union, with little trains
 * travelling along them), a departure-board flap that cycles through
 * destinations, and an animated underline. The planner sits at the bottom.
 */

const GO_GREEN = '#00853e';
const LIME = '#c6f26b';
const AMBER = '#ffb81c';

/** GO's line colours, with the direction each runs out of Union. */
const LINES = [
  { id: 'lw', color: '#98002e', d: 'M300 150 C 245 168, 170 205, -20 222' },
  { id: 'le', color: '#ee3124', d: 'M300 150 C 345 168, 385 190, 430 204' },
  { id: 'ba', color: '#0054a6', d: 'M300 150 C 292 100, 255 55, 215 -20' },
  { id: 'st', color: '#8b5a2b', d: 'M300 150 C 335 110, 380 72, 430 44' },
  { id: 'mi', color: '#f47b20', d: 'M300 150 C 245 132, 150 128, -20 96' },
  { id: 'ki', color: '#7ac143', d: 'M300 150 C 262 120, 208 92, 120 -20' },
] as const;

const DESTINATIONS = [
  'Oakville', 'Burlington', 'Oshawa', 'Barrie', 'Kitchener', 'Niagara Falls',
  'Hamilton', 'Aurora', 'Milton', 'Union Station',
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function HeroCard({
  phase,
  greeting,
  trainsLive,
  late,
  onSearch,
  children,
}: {
  phase: Phase;
  greeting: string;
  /** null until the first live update arrives. */
  trainsLive: number | null;
  late: number;
  onSearch: () => void;
  children: ReactNode;
}) {
  const night = phase === 'night' || phase === 'evening';
  const reduced = useReducedMotion();
  const onTime = trainsLive != null ? Math.max(0, trainsLive - late) : null;

  return (
    <header
      className="relative mt-4 overflow-visible rounded-[28px] text-white shadow-[0_22px_44px_-22px_rgb(0_80_40/0.75)]"
      style={{
        background: night
          ? 'linear-gradient(155deg, #03291a 0%, #005228 55%, #00722f 100%)'
          : `linear-gradient(155deg, #006632 0%, ${GO_GREEN} 52%, #14a552 100%)`,
      }}
    >
      {/* Livery stripe: white and lime, with a shimmer running along it. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[7px] overflow-hidden rounded-t-[28px]">
        <div className="h-full w-full" style={{ background: `linear-gradient(90deg, #fff 0 38%, ${LIME} 38% 100%)` }} />
        <div className="gh-shimmer absolute inset-y-0 w-1/3" />
      </div>

      {/* Network diagram, clipped to the card's upper area. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[290px] overflow-hidden rounded-t-[28px]">
        <NetworkMap reduced={reduced} />
        {/* Keeps the headline readable over the lines. */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(95deg, rgb(0 50 24 / 0.68) 0%, rgb(0 60 28 / 0.35) 55%, transparent 80%)' }}
        />
      </div>

      <div className="relative px-5 pt-6 pb-5">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search stations, lines or buses"
            className="grid size-11 place-items-center rounded-full bg-white text-[#006632] shadow-md transition-transform active:scale-95"
          >
            <SearchIcon className="size-5" />
          </button>

          {/* Departure-board style status. */}
          <span
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-mono text-[11px] font-bold tracking-[0.1em] uppercase"
            style={{ background: '#08150d', color: AMBER, boxShadow: 'inset 0 0 0 1px rgb(255 184 28 / 0.25)' }}
          >
            <span className="live-dot size-2 rounded-full" style={{ background: '#22c55e' }} aria-hidden />
            {trainsLive == null ? 'Live' : `${trainsLive} trains`}
            {late > 0 ? (
              <span style={{ color: '#ff8a7a' }}>{late} late</span>
            ) : trainsLive != null ? (
              <span style={{ color: '#86efac' }}>on time</span>
            ) : null}
          </span>
        </div>

        <p className="mt-5 text-[13px] font-semibold tracking-wide text-white/85">{greeting}</p>
        <h1 className="mt-0.5 text-[44px] leading-[0.98] font-black tracking-[-0.03em]">
          Where to
          <br />
          <span className="relative inline-block" style={{ color: LIME }}>
            today?
            <svg aria-hidden viewBox="0 0 150 12" className="absolute -bottom-2 left-0 h-3 w-full" fill="none" preserveAspectRatio="none">
              <path
                d="M3 8 C 30 1, 60 11, 90 5 S 135 3, 147 7"
                stroke={LIME}
                strokeWidth="3.4"
                strokeLinecap="round"
                pathLength="1"
                className={reduced ? '' : 'gh-draw'}
              />
            </svg>
          </span>
        </h1>

        <div className="mt-5 flex items-center gap-2.5">
          <span className="text-[12px] font-semibold text-white/80">Next up</span>
          <DestinationFlap reduced={reduced} />
        </div>
        {onTime != null ? (
          <p className="mt-2 text-[12.5px] font-medium text-white/80">
            {onTime} of {trainsLive} trains are running on time right now.
          </p>
        ) : null}

        <div className="mt-4">{children}</div>
      </div>
    </header>
  );
}

/** A split-flap board that flips through destinations. */
function DestinationFlap({ reduced }: { reduced: boolean }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % DESTINATIONS.length), 2600);
    return () => clearInterval(timer);
  }, [reduced]);

  const name = DESTINATIONS[index];
  return (
    <span
      className="relative inline-flex h-8 min-w-[150px] items-center overflow-hidden rounded-md px-3 font-mono text-[14px] font-bold tracking-[0.06em] uppercase"
      style={{ background: '#08150d', color: AMBER, boxShadow: 'inset 0 0 0 1px rgb(255 184 28 / 0.28)' }}
      aria-live="off"
    >
      <span key={name} className={reduced ? '' : 'gh-flip'} style={{ display: 'inline-block' }}>
        {name}
      </span>
      {/* The hinge line across the middle of a flap. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/60" />
    </span>
  );
}

/** Lines converging on Union, with trains running along them. */
function NetworkMap({ reduced }: { reduced: boolean }) {
  return (
    <svg viewBox="0 0 400 260" preserveAspectRatio="xMaxYMin slice" className="absolute inset-0 size-full" fill="none">
      <defs>
        {LINES.map((line) => (
          <path key={line.id} id={`gh-${line.id}`} d={line.d} />
        ))}
      </defs>

      {/* White casing first, so every colour reads on green. */}
      {LINES.map((line) => (
        <use key={`c-${line.id}`} href={`#gh-${line.id}`} stroke="rgb(255 255 255 / 0.9)" strokeWidth="9" strokeLinecap="round" />
      ))}
      {LINES.map((line) => (
        <use key={`l-${line.id}`} href={`#gh-${line.id}`} stroke={line.color} strokeWidth="5.4" strokeLinecap="round" />
      ))}
      {/* Stations: evenly spaced dots along each line. */}
      {LINES.map((line) => (
        <use
          key={`s-${line.id}`}
          href={`#gh-${line.id}`}
          stroke="#fff"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeDasharray="0.01 26"
          opacity="0.95"
        />
      ))}

      {/* Trains, out and back. */}
      {LINES.map((line, i) => (
        <Train
          key={`t-${line.id}`}
          color={line.color}
          path={`#gh-${line.id}`}
          dur={9 + i * 1.7}
          begin={-i * 1.9}
          reverse={i % 2 === 1}
          reduced={reduced}
          restX={230 + i * 8}
          restY={160 + i * 4}
        />
      ))}

      {/* Union: the hub, with a pulse going out. */}
      <circle cx="300" cy="150" r="11" fill="#fff" />
      <circle cx="300" cy="150" r="6.5" fill={GO_GREEN} />
      {!reduced ? (
        <circle cx="300" cy="150" r="11" stroke="#fff" strokeWidth="2" fill="none">
          <animate attributeName="r" values="11;34" dur="2.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.75;0" dur="2.8s" repeatCount="indefinite" />
        </circle>
      ) : null}
      <text x="300" y="176" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif" letterSpacing="0.6" opacity="0.95">
        UNION
      </text>
    </svg>
  );
}

function Train({
  color,
  path,
  dur,
  begin,
  reverse,
  reduced,
  restX,
  restY,
}: {
  color: string;
  path: string;
  dur: number;
  begin: number;
  reverse: boolean;
  reduced: boolean;
  restX: number;
  restY: number;
}) {
  const body = (
    <g>
      <rect x="-9" y="-4.6" width="18" height="9.2" rx="3.4" fill="#fff" stroke={color} strokeWidth="2" />
      <rect x="-5" y="-2" width="4" height="3.4" rx="1" fill={color} />
      <rect x="0.6" y="-2" width="4" height="3.4" rx="1" fill={color} />
      <circle cx="9.5" cy="0" r="1.6" fill="#fde047" />
    </g>
  );
  if (reduced) return <g transform={`translate(${restX} ${restY})`}>{body}</g>;
  return (
    <g>
      {body}
      <animateMotion
        dur={`${dur}s`}
        begin={`${begin}s`}
        repeatCount="indefinite"
        rotate={reverse ? 'auto-reverse' : 'auto'}
        keyPoints={reverse ? '1;0' : '0;1'}
        keyTimes="0;1"
        calcMode="linear"
      >
        <mpath href={path} />
      </animateMotion>
    </g>
  );
}
