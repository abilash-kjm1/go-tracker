'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SearchIcon } from '@/components/search/SearchOverlay';
import type { Phase } from './phase';

/**
 * The home hero. A deep GO-green field with a transit-map corner motif, the
 * headline, a live summary and a split-flap board showing where trains are
 * actually heading right now. The planner is the tear-off stub below the
 * perforation — it is the product, so it gets the light.
 */

const MINT = '#7dfab8';

/** Deep behind the headline, richer towards the stub. Shifts with the Toronto sky. */
const SURFACE: Record<Phase, { from: string; to: string; light: string }> = {
  morning: { from: '#04331f', to: '#067a46', light: '#8ef0bd' },
  day: { from: '#042a1b', to: '#056e3f', light: '#7dfab8' },
  evening: { from: '#03241a', to: '#055f39', light: '#6ee7b7' },
  night: { from: '#010f0a', to: '#033d26', light: '#34d399' },
};

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

/** Rolls a number to its new value, so a changing count is felt, not just read. */
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
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      setShown(Math.round(from + (value - from) * (1 - (1 - t) ** 3)));
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
  linesOut,
  destinations,
  onSearch,
  children,
}: {
  phase: Phase;
  greeting: string;
  /** null until the first live update arrives. */
  trainsLive: number | null;
  late: number;
  linesOut: number;
  /** Where trains are actually heading right now. Empty when nothing is live. */
  destinations: string[];
  onSearch: () => void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const skin = SURFACE[phase];
  const count = useCountUp(trainsLive, reduced);
  const onTime = trainsLive != null ? Math.max(0, trainsLive - late) : null;

  return (
    <header
      className="relative mt-4 overflow-hidden rounded-[28px] text-white shadow-[0_24px_50px_-28px_rgb(0_45_25/0.9)]"
      style={{ background: `linear-gradient(168deg, ${skin.from} 0%, ${skin.to} 100%)` }}
    >
      {/* A light source at the top right, and the network geometry at the foot. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-16 size-72 rounded-full"
        style={{ background: `radial-gradient(circle, ${skin.light} 0%, transparent 70%)`, opacity: 0.16 }}
      />
      <RouteMotif />

      <div className="relative px-6 pt-6">
        {/* Status line: state on the left, search on the right. */}
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 rounded-full bg-white/10 py-1.5 pr-3.5 pl-2.5 text-[11px] font-semibold tracking-[0.1em] uppercase ring-1 ring-white/15 backdrop-blur">
            <span className="live-dot size-1.5 rounded-full" style={{ background: MINT }} aria-hidden />
            {trainsLive == null ? 'Connecting' : 'Live'}
          </span>
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search stations, lines or buses"
            className="grid size-10 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/20 active:scale-95"
          >
            <SearchIcon className="size-[18px]" />
          </button>
        </div>

        <p className="mt-9 text-[11px] font-bold tracking-[0.2em] text-white/55 uppercase">{greeting}</p>
        <h1 className="mt-2 text-[44px] leading-[0.94] font-extrabold tracking-[-0.04em]">
          Where to
          <br />
          <span style={{ color: MINT }}>today?</span>
        </h1>

        {/* The live picture, as numbers rather than decoration. */}
        {trainsLive != null ? (
          <dl className="mt-7 flex items-stretch gap-4 text-white">
            <Stat value={count ?? trainsLive} label="trains out" />
            <Rule />
            <Stat value={onTime ?? 0} label="on time" tint={late === 0 ? MINT : undefined} />
            <Rule />
            <Stat value={linesOut} label={linesOut === 1 ? 'line' : 'lines'} />
          </dl>
        ) : (
          <p className="mt-7 text-[13px] text-white/60">Checking live GO services…</p>
        )}

        {/* Real destinations, on a board that flips like a station sign. */}
        {destinations.length > 0 ? (
          <div className="mt-6 flex items-center gap-3">
            <span className="shrink-0 text-[10px] font-bold tracking-[0.18em] text-white/45 uppercase">
              Heading to
            </span>
            <DestinationFlap names={destinations} reduced={reduced} />
          </div>
        ) : null}
      </div>

      {/* Ticket perforation: the planner is the tear-off stub. */}
      <div aria-hidden className="relative mt-7 h-4">
        <span className="absolute top-1/2 -left-2 size-4 -translate-y-1/2 rounded-full" style={{ background: 'var(--bg)' }} />
        <span className="absolute top-1/2 -right-2 size-4 -translate-y-1/2 rounded-full" style={{ background: 'var(--bg)' }} />
        <span className="absolute top-1/2 right-5 left-5 border-t border-dashed border-white/25" />
      </div>

      <div className="relative px-6 pt-1 pb-6">{children}</div>
    </header>
  );
}

function Stat({ value, label, tint }: { value: number; label: string; tint?: string }) {
  return (
    <div className="min-w-0">
      <dd className="tabular text-[27px] leading-none font-bold tracking-tight" style={tint ? { color: tint } : undefined}>
        {value}
      </dd>
      <dt className="mt-1.5 text-[11px] font-medium tracking-wide text-white/55">{label}</dt>
    </div>
  );
}

function Rule() {
  return <span aria-hidden className="w-px self-stretch bg-white/15" />;
}

/**
 * A split-flap board. It shows one real destination at a time from the live
 * list, so it never invents a service that is not running.
 */
function DestinationFlap({ names, reduced }: { names: string[]; reduced: boolean }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduced || names.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % names.length), 2800);
    return () => clearInterval(timer);
  }, [reduced, names.length]);

  const name = names[index % names.length];
  return (
    <span
      className="relative inline-flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-md px-3 font-mono text-[13px] font-bold tracking-[0.06em] uppercase"
      style={{
        background: 'rgb(0 0 0 / 0.38)',
        color: '#ffd98a',
        boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.1)',
      }}
    >
      <span key={name} className={`truncate ${reduced ? '' : 'gh-flip'}`}>
        {name}
      </span>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/45" />
    </span>
  );
}

/**
 * Transit-map geometry in the bottom corner: 45° bends, even stroke weights and
 * station ticks, cropped by the card edge. Decorative, and deliberately quiet.
 */
function RouteMotif() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 260 210"
      className="pointer-events-none absolute right-0 bottom-0 h-[210px] w-[260px]"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g strokeWidth="7" opacity="0.14" stroke="#fff">
        <path d="M268 34 H198 L156 76 H74 L30 120 H-8" />
        <path d="M268 76 H214 L160 130 H56 L16 170" />
      </g>
      <g strokeWidth="7" opacity="0.2">
        <path d="M268 120 H226 L182 164 H92" stroke={MINT} />
        <path d="M206 214 V168 L268 106" stroke="#fff" opacity="0.5" />
      </g>
      <g fill="#fff" opacity="0.25">
        {[
          [198, 34],
          [156, 76],
          [74, 76],
          [214, 76],
          [160, 130],
          [226, 120],
          [182, 164],
          [206, 168],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" />
        ))}
      </g>
    </svg>
  );
}
