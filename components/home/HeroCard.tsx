'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { SearchIcon } from '@/components/search/SearchOverlay';
import type { Phase } from './phase';

/**
 * The home hero, in GO's own colours. A deep green surface lit from the
 * top-right, with drifting glows, a fine grain and a dot grid for depth; a
 * split-flap destination board; and the whole network as one line ribbon. The
 * planner sits below a ticket perforation, so the card reads as a GO ticket.
 */

const LIME = '#c6f26b';
const AMBER = '#ffb81c';

/** Greens shift with the Toronto sky; all four keep white text well clear of the floor. */
const SURFACE: Record<Phase, { from: string; mid: string; to: string; glowA: string; glowB: string }> = {
  morning: { from: '#006b37', mid: '#008a45', to: '#12a95f', glowA: '#bbf7a0', glowB: '#5eead4' },
  day: { from: '#00542b', mid: '#00803f', to: '#10a257', glowA: '#c6f26b', glowB: '#34d399' },
  evening: { from: '#03301f', mid: '#065f3c', to: '#0b8a52', glowA: '#6ee7b7', glowB: '#22d3ee' },
  night: { from: '#01140d', mid: '#03291a', to: '#064e30', glowA: '#34d399', glowB: '#2563eb' },
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

/** A little film grain keeps a big flat colour from banding. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

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
  const rise = (delay: number) => (reduced ? undefined : { animationDelay: `${delay}ms` });

  return (
    <header
      className="relative mt-4 overflow-hidden rounded-[30px] text-white"
      style={{
        background: `radial-gradient(130% 100% at 88% -10%, ${skin.to} 0%, ${skin.mid} 42%, ${skin.from} 100%)`,
        boxShadow: '0 28px 56px -26px rgb(0 60 30 / 0.75), inset 0 1px 0 rgb(255 255 255 / 0.22)',
      }}
    >
      {/* Two soft glows drift behind everything, so the green is never flat. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className={reduced ? 'absolute -top-24 -left-20 size-72 rounded-full' : 'gh-drift-a absolute -top-24 -left-20 size-72 rounded-full'}
          style={{ background: `radial-gradient(circle, ${skin.glowA} 0%, transparent 68%)`, opacity: 0.36, filter: 'blur(30px)' }}
        />
        <span
          className={reduced ? 'absolute -right-24 -bottom-20 size-80 rounded-full' : 'gh-drift-b absolute -right-24 -bottom-20 size-80 rounded-full'}
          style={{ background: `radial-gradient(circle, ${skin.glowB} 0%, transparent 68%)`, opacity: 0.3, filter: 'blur(36px)' }}
        />
      </div>

      {/* Dot grid, fading out before it reaches the planner. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgb(255 255 255 / 0.26) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'linear-gradient(180deg, rgb(0 0 0 / 0.5) 0%, transparent 58%)',
          WebkitMaskImage: 'linear-gradient(180deg, rgb(0 0 0 / 0.5) 0%, transparent 58%)',
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.16] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />

      {/* A slow diagonal sheen, like light crossing a train window. */}
      {!reduced ? <div aria-hidden className="gh-sheen pointer-events-none absolute -inset-y-10 w-1/4" /> : null}

      {/* Livery stripe: white and lime, with a shimmer running along it. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[7px] overflow-hidden">
        <div className="h-full w-full" style={{ background: `linear-gradient(90deg, #fff 0 38%, ${LIME} 38% 100%)` }} />
        {!reduced ? <div className="gh-shimmer absolute inset-y-0 w-1/3" /> : null}
      </div>

      <div className="relative px-5 pt-6">
        <div className={reduced ? '' : 'gh-rise'} style={rise(0)}>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onSearch}
              aria-label="Search stations, lines or buses"
              className="grid size-11 place-items-center rounded-full bg-white text-[#006632] shadow-[0_6px_16px_-6px_rgb(0_0_0/0.6)] transition-transform active:scale-95"
            >
              <SearchIcon className="size-5" />
            </button>
            <LedPanel>
              <span className="live-dot size-2 rounded-full" style={{ background: '#22c55e' }} aria-hidden />
              {trainsLive == null ? 'Live' : `${trainsLive} trains`}
              {late > 0 ? (
                <span style={{ color: '#ff8a7a' }}>{late} late</span>
              ) : trainsLive != null ? (
                <span style={{ color: '#86efac' }}>on time</span>
              ) : null}
            </LedPanel>
          </div>
        </div>

        <p
          className={`mt-7 text-[11px] font-bold tracking-[0.22em] text-white/70 uppercase ${reduced ? '' : 'gh-rise'}`}
          style={rise(70)}
        >
          {greeting}
        </p>
        <h1
          className={`mt-2 text-[46px] leading-[0.95] font-black tracking-[-0.035em] ${reduced ? '' : 'gh-rise'}`}
          style={{
            ...rise(130),
            background: `linear-gradient(112deg, #ffffff 0%, #ffffff 46%, ${LIME} 78%)`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            textShadow: '0 2px 18px rgb(0 0 0 / 0.18)',
          }}
        >
          Where to
          <br />
          <span className="relative inline-block">
            today?
            <svg aria-hidden viewBox="0 0 150 12" className="absolute -bottom-3.5 left-0 h-3 w-full" fill="none" preserveAspectRatio="none">
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

        <div className={`mt-7 flex flex-wrap items-center gap-3 ${reduced ? '' : 'gh-rise'}`} style={rise(190)}>
          <span className="text-[10px] font-bold tracking-[0.18em] text-white/60 uppercase">Next up</span>
          <DestinationFlap reduced={reduced} />
        </div>
        {onTime != null ? (
          <p className={`mt-3 text-[12.5px] font-medium text-white/75 ${reduced ? '' : 'gh-rise'}`} style={rise(240)}>
            <span className="font-bold text-white">{onTime}</span> of {trainsLive} trains are running on time
          </p>
        ) : null}

        {/* The whole network as one clean rule, with a train riding it. */}
        <div className={reduced ? '' : 'gh-rise'} style={rise(290)}>
          <LineRibbon reduced={reduced} />
        </div>
      </div>

      {/* Ticket perforation: the planner is the tear-off stub. */}
      <div aria-hidden className="relative mt-5 h-5">
        <span className="absolute top-1/2 -left-2.5 size-5 -translate-y-1/2 rounded-full" style={{ background: 'var(--bg)' }} />
        <span className="absolute top-1/2 -right-2.5 size-5 -translate-y-1/2 rounded-full" style={{ background: 'var(--bg)' }} />
        <span className="absolute top-1/2 right-4 left-4 border-t-2 border-dashed border-white/25" />
      </div>

      <div className="relative px-5 pb-5">{children}</div>
    </header>
  );
}

/** Amber-on-black, with a dot-matrix texture so it reads as a real station sign. */
function LedPanel({ children }: { children: ReactNode }) {
  return (
    <span
      className="relative flex items-center gap-2.5 overflow-hidden rounded-lg px-3 py-2 font-mono text-[11px] font-bold tracking-[0.1em] uppercase"
      style={{ background: '#08150d', color: AMBER, boxShadow: 'inset 0 0 0 1px rgb(255 184 28 / 0.28), 0 6px 18px -8px rgb(0 0 0 / 0.9)' }}
    >
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage: 'radial-gradient(circle, transparent 42%, rgb(0 0 0 / 0.55) 60%)',
          backgroundSize: '3px 3px',
        }}
      />
    </span>
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
      className="relative inline-flex h-9 min-w-[168px] items-center overflow-hidden rounded-lg px-3.5 font-mono text-[14.5px] font-bold tracking-[0.07em] uppercase"
      style={{
        background: 'linear-gradient(180deg, #101f14 0%, #08150d 49%, #0d1a11 51%, #060f09 100%)',
        color: AMBER,
        boxShadow: 'inset 0 0 0 1px rgb(255 184 28 / 0.3), inset 0 10px 14px -12px rgb(255 255 255 / 0.35), 0 8px 20px -10px rgb(0 0 0 / 0.9)',
      }}
      aria-live="off"
    >
      <span key={name} className={reduced ? '' : 'gh-flip'} style={{ display: 'inline-block' }}>
        {name}
      </span>
      {/* The hinge line across the middle of a flap, and the glass above it. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/70" />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/[0.06]" />
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
    <svg aria-hidden viewBox={`0 0 ${width} 18`} preserveAspectRatio="none" className="mt-6 h-4 w-full" fill="none">
      <defs>
        <path id="gh-ribbon" d={`M6 9 H ${width - 6}`} />
        <filter id="gh-trail" x="-30%" y="-120%" width="160%" height="340%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* A dark bed under the colours lifts them off the green. */}
      <line x1="6" y1="9" x2={width - 6} y2="9" stroke="rgb(0 0 0 / 0.28)" strokeWidth="9" strokeLinecap="round" />

      {LINES.map((line, i) => (
        <line
          key={line.code}
          x1={i === 0 ? 6 : i * segment}
          y1="9"
          x2={i === LINES.length - 1 ? width - 6 : (i + 1) * segment}
          y2="9"
          stroke={line.color}
          strokeWidth="5.5"
          strokeLinecap={i === 0 || i === LINES.length - 1 ? 'round' : 'butt'}
        />
      ))}
      {LINES.map((line, i) => (
        <circle key={`d-${line.code}`} cx={i * segment + segment / 2} cy="9" r="2.5" fill="#fff" opacity="0.95" />
      ))}

      {reduced ? (
        <g transform={`translate(${width / 2} 9)`}>
          <RibbonTrain />
        </g>
      ) : (
        <g>
          <ellipse cx="-14" cy="0" rx="14" ry="3" fill="#fff" opacity="0.5" filter="url(#gh-trail)" />
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
      <rect x="-11.5" y="-5.5" width="23" height="11" rx="4.5" fill="#fff" />
      <rect x="-6.8" y="-2.4" width="4.6" height="3.8" rx="1.2" fill="#0f172a" opacity="0.62" />
      <rect x="0.2" y="-2.4" width="4.6" height="3.8" rx="1.2" fill="#0f172a" opacity="0.62" />
      <circle cx="8.8" cy="0" r="1.6" fill="#fde047" />
    </g>
  );
}
