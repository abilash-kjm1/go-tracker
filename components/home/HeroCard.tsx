'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SearchIcon } from '@/components/search/SearchOverlay';
import type { Phase } from './phase';

/**
 * The home hero. A vivid GO-green field with a drifting hatch, a line ticker
 * along the top edge, a split-flap destination board and the network as one
 * line ribbon with a light pulse running through it. The planner is the
 * tear-off stub below the perforation.
 */

const MINT = '#7dfab8';
const AMBER = '#ffb81c';

/** Deep behind the headline, vivid towards the stub. Shifts with the Toronto sky. */
const SURFACE: Record<Phase, { from: string; to: string }> = {
  morning: { from: '#013a25', to: '#00c46a' },
  day: { from: '#00301f', to: '#00b25e' },
  evening: { from: '#022a1d', to: '#009a55' },
  night: { from: '#000f0a', to: '#00663a' },
};

/** GO's line colours, in the order they sit on the ribbon and the ticker. */
const LINES = [
  { code: 'LW', name: 'Lakeshore West', color: '#98002e' },
  { code: 'MI', name: 'Milton', color: '#f47b20' },
  { code: 'KI', name: 'Kitchener', color: '#7ac143' },
  { code: 'BA', name: 'Barrie', color: '#0054a6' },
  { code: 'ST', name: 'Stouffville', color: '#8b5a2b' },
  { code: 'RH', name: 'Richmond Hill', color: '#0f7ec2' },
  { code: 'LE', name: 'Lakeshore East', color: '#ee3124' },
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

/** Rolls a number up to its new value, so a changing count is felt, not just read. */
function useCountUp(value: number | null, reduced: boolean): number | null {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value ?? 0);
  useEffect(() => {
    if (value == null) return;
    if (reduced) {
      setShown(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const duration = 750;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else fromRef.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return value == null ? null : shown;
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
  const count = useCountUp(trainsLive, reduced);
  const onTime = trainsLive != null ? Math.max(0, trainsLive - late) : null;

  return (
    <header
      className="relative mt-4 overflow-hidden rounded-[26px] text-white shadow-[0_24px_48px_-26px_rgb(0_60_32/0.8)]"
      style={{ background: `linear-gradient(158deg, ${skin.from} 0%, ${skin.from} 26%, ${skin.to} 100%)` }}
    >
      {/* Diagonal hatch, drifting like sleepers passing under a train. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute -inset-x-10 inset-y-0 ${reduced ? '' : 'gh-hatch'}`}
        style={{
          backgroundImage: 'repeating-linear-gradient(118deg, rgb(255 255 255 / 0.05) 0 2px, transparent 2px 18px)',
        }}
      />

      {/* Line ticker along the top edge. */}
      <LineTicker reduced={reduced} />

      <div className="relative px-5 pt-14">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search stations, lines or buses"
            className="grid size-11 place-items-center rounded-2xl bg-white text-[#00512f] shadow-[0_8px_18px_-8px_rgb(0_0_0/0.7)] transition-transform active:scale-95"
          >
            <SearchIcon className="size-5" />
          </button>
          <LedPanel>
            <span className="live-dot size-2 rounded-full" style={{ background: '#22c55e' }} aria-hidden />
            {count == null ? 'Live' : `${count} trains`}
            {late > 0 ? (
              <span style={{ color: '#ff8a7a' }}>{late} late</span>
            ) : trainsLive != null ? (
              <span style={{ color: '#86efac' }}>on time</span>
            ) : null}
          </LedPanel>
        </div>

        <p className="mt-8 text-[11px] font-bold tracking-[0.24em] text-white/65 uppercase">{greeting}</p>
        <h1 className="mt-2.5 text-[46px] leading-[0.95] font-black tracking-[-0.035em]">
          Where to
          <br />
          <span className="relative inline-block">
            <span style={{ color: MINT }}>today?</span>
            {/* A marker stroke wipes in under the word and out again. */}
            <span
              aria-hidden
              className={`absolute -bottom-1.5 left-0 h-[6px] w-full origin-left rounded-full ${reduced ? '' : 'gh-highlight'}`}
              style={{ background: MINT }}
            />
          </span>
        </h1>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <span className="text-[10px] font-bold tracking-[0.2em] text-white/55 uppercase">Next up</span>
          <DestinationFlap reduced={reduced} />
        </div>
        {onTime != null ? (
          <p className="mt-3 text-[12.5px] font-medium text-white/75">
            <span className="font-bold text-white">{onTime}</span> of {trainsLive} trains are running on time
          </p>
        ) : null}

        <LineRibbon reduced={reduced} />
      </div>

      {/* Ticket perforation: the planner is the tear-off stub. */}
      <div aria-hidden className="relative mt-5 h-5">
        <span className="absolute top-1/2 -left-2.5 size-5 -translate-y-1/2 rounded-full" style={{ background: 'var(--bg)' }} />
        <span className="absolute top-1/2 -right-2.5 size-5 -translate-y-1/2 rounded-full" style={{ background: 'var(--bg)' }} />
        <span className="absolute top-1/2 right-4 left-4 border-t-2 border-dashed border-white/30" />
      </div>

      <div className="relative px-5 pb-5">{children}</div>
    </header>
  );
}

/** Line names scrolling past the top edge, the way a concourse sign does. */
function LineTicker({ reduced }: { reduced: boolean }) {
  const run = (
    <span className="flex shrink-0 items-center gap-6 pr-6">
      {LINES.map((line) => (
        <span key={line.code} className="flex items-center gap-2 whitespace-nowrap">
          <span className="size-2 rounded-full" style={{ background: line.color }} aria-hidden />
          <span className="text-[10px] font-bold tracking-[0.18em] text-white/75 uppercase">{line.name}</span>
        </span>
      ))}
    </span>
  );

  return (
    <div
      aria-hidden
      className="absolute inset-x-0 top-0 flex h-9 items-center overflow-hidden border-b border-white/15"
      style={{ background: 'rgb(0 0 0 / 0.22)' }}
    >
      <div className={`flex ${reduced ? '' : 'gh-ticker'}`}>
        {run}
        {run}
      </div>
    </div>
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
 * Every GO line as one horizontal rule, with a light pulse running along it —
 * a signal travelling the network rather than a single train.
 */
function LineRibbon({ reduced }: { reduced: boolean }) {
  const width = 300;
  const segment = width / LINES.length;
  return (
    <svg aria-hidden viewBox={`0 0 ${width} 16`} preserveAspectRatio="none" className="mt-7 h-3.5 w-full" fill="none">
      <line x1="6" y1="8" x2={width - 6} y2="8" stroke="rgb(0 0 0 / 0.3)" strokeWidth="9" strokeLinecap="round" />
      {LINES.map((line, i) => (
        <line
          key={line.code}
          x1={i === 0 ? 6 : i * segment}
          y1="8"
          x2={i === LINES.length - 1 ? width - 6 : (i + 1) * segment}
          y2="8"
          stroke={line.color}
          strokeWidth="5.5"
          strokeLinecap={i === 0 || i === LINES.length - 1 ? 'round' : 'butt'}
        />
      ))}
      {LINES.map((line, i) => (
        <circle key={`d-${line.code}`} cx={i * segment + segment / 2} cy="8" r="2.5" fill="#fff" opacity="0.95" />
      ))}
      {!reduced ? (
        <line
          x1="6"
          y1="8"
          x2={width - 6}
          y2="8"
          stroke="#fff"
          strokeWidth="5.5"
          strokeLinecap="round"
          className="gh-pulse"
          strokeDasharray="26 262"
        />
      ) : null}
    </svg>
  );
}
