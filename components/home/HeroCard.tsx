'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { SearchIcon } from '@/components/search/SearchOverlay';
import type { Phase } from './phase';

/**
 * The home hero, in GO's own colours. The surface is deliberately quiet — a deep
 * green wash with two slow-drifting glows and a fading dot grid — so the headline
 * and the planner stay the loudest things on it. The network is expressed as one
 * tidy line ribbon above the planner rather than lines crossing the text.
 */

const LIME = '#c6f26b';
const AMBER = '#ffb81c';

/** Greens shift with the Toronto sky; all four keep white text well clear of the floor. */
const SURFACE: Record<Phase, { from: string; to: string; glowA: string; glowB: string }> = {
  morning: { from: '#00713a', to: '#0aa05a', glowA: '#a7f3a0', glowB: '#5eead4' },
  day: { from: '#006634', to: '#0f9d52', glowA: '#c6f26b', glowB: '#34d399' },
  evening: { from: '#04412a', to: '#0c7a49', glowA: '#6ee7b7', glowB: '#2dd4bf' },
  night: { from: '#021a12', to: '#053d27', glowA: '#34d399', glowB: '#1e6bd6' },
};

/** GO's line colours, in the order they sit on the ribbon. */
const LINES = [
  { code: 'LW', color: '#98002e' },
  { code: 'MI', color: '#f47b20' },
  { code: 'KI', color: '#7ac143' },
  { code: 'BA', color: '#0054a6' },
  { code: 'ST', color: '#8b5a2b' },
  { code: 'RH', color: '#0f7ec2' },
  { code: 'LE', color: '#ee3124' },
];

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
  const reduced = useReducedMotion();
  const skin = SURFACE[phase];
  const onTime = trainsLive != null ? Math.max(0, trainsLive - late) : null;

  return (
    <header
      className="relative mt-4 overflow-hidden rounded-[28px] text-white shadow-[0_22px_44px_-22px_rgb(0_70_36/0.7)]"
      style={{ background: `linear-gradient(160deg, ${skin.from} 0%, ${skin.to} 100%)` }}
    >
      {/* Two soft glows drift behind everything, so the green is never flat. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="gh-drift-a absolute -top-24 -left-20 size-72 rounded-full"
          style={{ background: `radial-gradient(circle, ${skin.glowA} 0%, transparent 68%)`, opacity: 0.4, filter: 'blur(28px)' }}
        />
        <span
          className="gh-drift-b absolute -right-24 -bottom-16 size-80 rounded-full"
          style={{ background: `radial-gradient(circle, ${skin.glowB} 0%, transparent 68%)`, opacity: 0.32, filter: 'blur(34px)' }}
        />
      </div>

      {/* Dot grid, fading out before it reaches the planner. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(255 255 255 / 0.3) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          maskImage: 'linear-gradient(180deg, rgb(0 0 0 / 0.55) 0%, transparent 62%)',
          WebkitMaskImage: 'linear-gradient(180deg, rgb(0 0 0 / 0.55) 0%, transparent 62%)',
        }}
      />

      {/* Livery stripe: white and lime, with a shimmer running along it. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[7px] overflow-hidden">
        <div className="h-full w-full" style={{ background: `linear-gradient(90deg, #fff 0 38%, ${LIME} 38% 100%)` }} />
        <div className="gh-shimmer absolute inset-y-0 w-1/3" />
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

          {/* Station-sign style status. */}
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

        <p className="mt-6 text-[13px] font-semibold tracking-wide text-white/85">{greeting}</p>
        <h1 className="mt-1 text-[44px] leading-[0.98] font-black tracking-[-0.03em]">
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

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <span className="text-[12px] font-semibold text-white/80">Next up</span>
          <DestinationFlap reduced={reduced} />
        </div>
        {onTime != null ? (
          <p className="mt-2.5 text-[12.5px] font-medium text-white/80">
            {onTime} of {trainsLive} trains are running on time right now.
          </p>
        ) : null}

        {/* The whole network as one clean rule, with a train riding it. */}
        <LineRibbon reduced={reduced} />

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

/**
 * Every GO line as one horizontal rule: a run of colour segments with station
 * dots on it, and a small train gliding across. Decorative, and out of the way
 * of the text above it.
 */
function LineRibbon({ reduced }: { reduced: boolean }) {
  const width = 300;
  const segment = width / LINES.length;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} 16`}
      preserveAspectRatio="none"
      className="mt-5 h-4 w-full"
      fill="none"
    >
      <defs>
        <path id="gh-ribbon" d={`M4 8 H ${width - 4}`} />
      </defs>
      {LINES.map((line, i) => (
        <line
          key={line.code}
          x1={i === 0 ? 4 : i * segment}
          y1="8"
          x2={i === LINES.length - 1 ? width - 4 : (i + 1) * segment}
          y2="8"
          stroke={line.color}
          strokeWidth="5"
          strokeLinecap={i === 0 || i === LINES.length - 1 ? 'round' : 'butt'}
        />
      ))}
      {LINES.map((line, i) => (
        <circle key={`d-${line.code}`} cx={i * segment + segment / 2} cy="8" r="2.4" fill="#fff" opacity="0.95" />
      ))}
      {reduced ? (
        <g transform={`translate(${width / 2} 8)`}>
          <RibbonTrain />
        </g>
      ) : (
        <g>
          <RibbonTrain />
          <animateMotion dur="11s" repeatCount="indefinite" calcMode="linear">
            <mpath href="#gh-ribbon" />
          </animateMotion>
        </g>
      )}
    </svg>
  );
}

function RibbonTrain() {
  return (
    <g>
      <rect x="-11" y="-5" width="22" height="10" rx="4" fill="#fff" />
      <rect x="-6.5" y="-2.2" width="4.5" height="3.6" rx="1.1" fill="#0f172a" opacity="0.65" />
      <rect x="0" y="-2.2" width="4.5" height="3.6" rx="1.1" fill="#0f172a" opacity="0.65" />
      <circle cx="8.4" cy="0" r="1.5" fill="#fde047" />
    </g>
  );
}
