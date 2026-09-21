'use client';

import type { ReactNode } from 'react';
import { SearchIcon } from '@/components/search/SearchOverlay';
import type { Phase } from './HeroScene';

interface Palette {
  from: string;
  to: string;
  ink: string;
  accent: string;
  band: string;
  pill: string;
  pillInk: string;
  sun: string;
  ray: string;
}

/** A warm card that shifts with the Toronto sky. Text colours are chosen per palette. */
const PALETTE: Record<Phase, Palette> = {
  morning: {
    from: '#fff1d2', to: '#f7c46f', ink: '#4a2a0c', accent: '#b23a17',
    band: '#f5a623', pill: 'rgb(255 255 255 / 0.55)', pillInk: '#5a3510', sun: '#ffd36b', ray: '#f5a623',
  },
  day: {
    from: '#fde7c8', to: '#efa66b', ink: '#4a2410', accent: '#9a3412',
    band: '#f5a623', pill: 'rgb(255 255 255 / 0.5)', pillInk: '#5a2f14', sun: '#ffd25e', ray: '#f59e0b',
  },
  evening: {
    from: '#ffd9c9', to: '#e9808a', ink: '#4b1d2c', accent: '#a3162f',
    band: '#ff7a59', pill: 'rgb(255 255 255 / 0.5)', pillInk: '#5b2233', sun: '#ff9f5a', ray: '#ff7a59',
  },
  night: {
    from: '#3a2f74', to: '#1e1b4b', ink: '#fdf2e0', accent: '#ffd28a',
    band: '#8b7cf6', pill: 'rgb(255 255 255 / 0.12)', pillInk: '#efe6ff', sun: '#e9ecff', ray: '#a5b4fc',
  },
};

const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,'Times New Roman',serif";

/**
 * The home hero: a warm card with a train mascot peeking over its top edge, a
 * dripping lantern rail, a sun (or moon) that follows the Toronto sky, ripple
 * rings and a big serif headline. The planner slots in at the bottom.
 */
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
  const c = PALETTE[phase];
  const night = phase === 'night';
  const onTime = trainsLive != null ? Math.max(0, trainsLive - late) : null;

  return (
    <header className="relative mt-[88px]" style={{ color: c.ink }}>
      {/* Outside the card: sun or moon, and a little bus token. */}
      <Sun color={c.sun} ray={c.ray} moon={night} />
      <BusToken />

      {/* Mascot sits behind the card; only his head and hands show. */}
      <Mascot night={night} />

      <div
        className="relative rounded-[28px] px-5 pt-6 pb-5 shadow-[0_18px_40px_-18px_rgb(120_60_10/0.55)]"
        style={{ background: `linear-gradient(150deg, ${c.from} 0%, ${c.to} 100%)` }}
      >
        {/* Lantern rail along the top edge. */}
        <div
          aria-hidden
          className="absolute -top-[5px] right-5 left-5 h-[9px] rounded-full"
          style={{ background: c.band, boxShadow: `0 6px 14px -4px ${c.band}` }}
        />
        <Drip left="21%" h={16} color={c.band} />
        <Drip left="61%" h={24} color={c.band} delay="0.6s" />
        <Drip left="90%" h={12} color={c.band} delay="1.2s" />

        {/* Ripple rings, like a signal going out. */}
        <div aria-hidden className="pointer-events-none absolute top-0 right-0 size-40 overflow-hidden rounded-tr-[28px]">
          <span className="hc-ring absolute -top-16 -right-16 size-48 rounded-full border" style={{ borderColor: c.ink, '--ring-o': 0.16 } as React.CSSProperties} />
          <span className="hc-ring absolute -top-24 -right-24 size-64 rounded-full border" style={{ borderColor: c.ink, '--ring-o': 0.1, animationDelay: '1.4s' } as React.CSSProperties} />
        </div>

        <div className="relative flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search stations, lines or buses"
            className="grid size-11 place-items-center rounded-full shadow-sm transition-transform active:scale-95"
            style={{ background: c.pill, color: c.pillInk }}
          >
            <SearchIcon className="size-5" />
          </button>
          <span
            className="flex items-center gap-2 rounded-full px-3.5 py-2 text-[10.5px] font-extrabold tracking-[0.14em] uppercase"
            style={{ background: c.pill, color: c.pillInk }}
          >
            <span className="live-dot size-2 rounded-full bg-[#16a34a]" aria-hidden />
            {trainsLive == null ? 'Live' : `${trainsLive} trains live`}
            {late > 0 ? <span style={{ color: c.accent }}>· {late} late</span> : null}
          </span>
        </div>

        <p className="relative mt-5 text-[14px] font-semibold opacity-80">{greeting}</p>
        <h1
          className="relative mt-0.5 text-[46px] leading-[0.98] font-bold tracking-tight"
          style={{ fontFamily: SERIF, color: c.accent }}
        >
          Where to,
          <br />
          today?
        </h1>
        <p className="relative mt-2 text-[14px] font-medium opacity-80">
          {onTime == null
            ? 'Pick where you are and where you want to be.'
            : `${onTime} of ${trainsLive} trains are on time right now.`}
        </p>

        <div className="relative mt-4">{children}</div>
      </div>

      {/* A little paw-print of a corner sticker, bottom left. */}
      <span
        aria-hidden
        className="absolute -bottom-3 -left-2 grid size-9 -rotate-12 place-items-center rounded-full border-2 text-[15px] shadow-md"
        style={{ background: c.from, borderColor: c.ink }}
      >
        🎫
      </span>
    </header>
  );
}

function Drip({ left, h, color, delay = '0s' }: { left: string; h: number; color: string; delay?: string }) {
  return (
    <span
      aria-hidden
      className="hc-drip absolute top-1 w-2 rounded-b-full"
      style={{ left, height: h, background: color, animationDelay: delay }}
    >
      <span className="absolute bottom-0 left-1/2 size-3 -translate-x-1/2 translate-y-1/3 rounded-full" style={{ background: color }} />
    </span>
  );
}

function Sun({ color, ray, moon }: { color: string; ray: string; moon: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 60 60"
      className="pointer-events-none absolute -top-14 right-1 size-14"
    >
      <g className={moon ? '' : 'hc-spin'} style={{ transformOrigin: '30px 30px' }}>
        {!moon
          ? Array.from({ length: 10 }, (_, i) => (
              <line
                key={i}
                x1="30" y1="4" x2="30" y2="11"
                stroke={ray}
                strokeWidth="3"
                strokeLinecap="round"
                transform={`rotate(${i * 36} 30 30)`}
              />
            ))
          : null}
      </g>
      <circle cx="30" cy="30" r="13" fill={color} stroke="#3b2412" strokeWidth="2.4" />
      {moon ? <circle cx="35" cy="26" r="11" fill="#1e1b4b" opacity="0.55" /> : null}
    </svg>
  );
}

function BusToken() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 60 44"
      className="hc-bob pointer-events-none absolute -top-11 -left-3 z-20 h-10 w-[52px]"
    >
      <rect x="4" y="6" width="52" height="27" rx="8" fill="#fb923c" stroke="#3b2412" strokeWidth="2.4" />
      <rect x="10" y="12" width="12" height="9" rx="2.5" fill="#fff7e6" stroke="#3b2412" strokeWidth="1.6" />
      <rect x="26" y="12" width="12" height="9" rx="2.5" fill="#fff7e6" stroke="#3b2412" strokeWidth="1.6" />
      <rect x="42" y="12" width="9" height="9" rx="2.5" fill="#fff7e6" stroke="#3b2412" strokeWidth="1.6" />
      <path d="M4 26h52" stroke="#3b2412" strokeWidth="1.6" />
      <circle cx="16" cy="34" r="5" fill="#3b2412" />
      <circle cx="44" cy="34" r="5" fill="#3b2412" />
      <circle cx="16" cy="34" r="1.7" fill="#fff7e6" />
      <circle cx="44" cy="34" r="1.7" fill="#fff7e6" />
    </svg>
  );
}

/** A friendly little train, peeking over the card and holding on with both hands. */
function Mascot({ night }: { night: boolean }) {
  const ink = '#3b2412';
  return (
    <>
      <svg
        aria-hidden
        viewBox="0 0 140 96"
        className="hc-peek pointer-events-none absolute -top-[74px] left-1/2 z-0 h-[96px] w-[140px] -translate-x-1/2"
      >
        {/* Signal lamps for ears. */}
        <circle cx="26" cy="26" r="13" fill="#34d399" stroke={ink} strokeWidth="2.6" />
        <circle cx="26" cy="26" r="6" fill="#fff7e6" />
        <circle cx="114" cy="26" r="13" fill="#34d399" stroke={ink} strokeWidth="2.6" />
        <circle cx="114" cy="26" r="6" fill="#fff7e6" />

        {/* Head: the front of a train. */}
        <rect x="18" y="12" width="104" height="78" rx="36" fill="#34d399" stroke={ink} strokeWidth="2.8" />
        <rect x="31" y="27" width="78" height="54" rx="24" fill="#fff7e6" />

        {/* Headlight and GO badge. */}
        <circle cx="70" cy="11" r="8" fill="#fde047" stroke={ink} strokeWidth="2.4" />
        <rect x="54" y="15" width="32" height="13" rx="6.5" fill="#059669" stroke={ink} strokeWidth="2" />
        <text x="70" y="25" textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
          GO
        </text>

        {/* Face. */}
        <g className="hc-blink" style={{ transformOrigin: '70px 50px' }}>
          <circle cx="54" cy="50" r="5.2" fill={ink} />
          <circle cx="86" cy="50" r="5.2" fill={ink} />
          <circle cx="55.8" cy="48" r="1.7" fill="#fff" />
          <circle cx="87.8" cy="48" r="1.7" fill="#fff" />
        </g>
        <ellipse cx="44" cy="61" rx="7.5" ry="5" fill="#ff8fa3" opacity="0.75" />
        <ellipse cx="96" cy="61" rx="7.5" ry="5" fill="#ff8fa3" opacity="0.75" />
        <path d="M62 60q8 8 16 0" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
        {night ? <path d="M40 14q30-14 60 0" fill="none" stroke="#fde68a" strokeWidth="2" opacity="0.6" /> : null}
      </svg>

      {/* Hands, in front of the card edge. */}
      <svg
        aria-hidden
        viewBox="0 0 140 30"
        className="pointer-events-none absolute -top-[15px] left-1/2 z-20 h-[30px] w-[140px] -translate-x-1/2"
      >
        <g className="hc-wave" style={{ transformOrigin: '38px 18px' }}>
          <ellipse cx="38" cy="16" rx="13.5" ry="10.5" fill="#fff7e6" stroke={ink} strokeWidth="2.6" />
          <path d="M31 11v9M38 10v10M45 11v9" stroke={ink} strokeWidth="1.8" strokeLinecap="round" />
        </g>
        <g className="hc-wave" style={{ transformOrigin: '102px 18px', animationDelay: '0.5s' }}>
          <ellipse cx="102" cy="16" rx="13.5" ry="10.5" fill="#fff7e6" stroke={ink} strokeWidth="2.6" />
          <path d="M95 11v9M102 10v10M109 11v9" stroke={ink} strokeWidth="1.8" strokeLinecap="round" />
        </g>
      </svg>
    </>
  );
}
