'use client';

import { useEffect, useState } from 'react';
import { torontoParts } from '@/lib/transit/time';

export type Phase = 'morning' | 'day' | 'evening' | 'night';

/** Where the sun is in Toronto right now, so the scene matches the sky outside. */
export function phaseFor(hour: number): Phase {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'evening';
  return 'night';
}

export function usePhase(): Phase {
  const [phase, setPhase] = useState<Phase>('day');
  useEffect(() => {
    const update = () => setPhase(phaseFor(torontoParts().hour));
    update();
    const timer = setInterval(update, 5 * 60_000);
    return () => clearInterval(timer);
  }, []);
  return phase;
}

/** Sky colours, dark enough at the top-left that the white heading always reads. */
export const SKY: Record<Phase, { top: string; bottom: string; glow: string; ground: string }> = {
  morning: { top: '#0f766e', bottom: '#f59e0b', glow: '#fde68a', ground: '#134e4a' },
  day: { top: '#075985', bottom: '#38bdf8', glow: '#e0f2fe', ground: '#0c4a6e' },
  evening: { top: '#3b0764', bottom: '#f97316', glow: '#fdba74', ground: '#3b0764' },
  night: { top: '#020617', bottom: '#1e3a8a', glow: '#c7d2fe', ground: '#020617' },
};

const SUN: Record<Phase, { x: number; y: number; r: number; color: string }> = {
  morning: { x: 292, y: 122, r: 17, color: '#fde68a' },
  day: { x: 250, y: 108, r: 15, color: '#fef9c3' },
  evening: { x: 96, y: 124, r: 19, color: '#fb923c' },
  night: { x: 250, y: 104, r: 13, color: '#e2e8f0' },
};

const STARS: Array<[number, number, number]> = [
  [30, 22, 0], [72, 48, 0.6], [118, 16, 1.1], [168, 40, 0.3], [214, 20, 1.6],
  [262, 52, 0.9], [356, 30, 0.2], [382, 66, 1.3], [150, 70, 0.7], [246, 84, 1.9],
];

/** Toronto-style skyline, back row then front row. */
function Skyline({ night }: { night: boolean }) {
  const far = 'rgba(255,255,255,0.10)';
  const near = 'rgba(2,6,23,0.45)';
  return (
    <g>
      {/* Back row. */}
      <path
        fill={far}
        d="M0 176V132h14v-8h18v20h12v-34h16v34h14V118h20v30h10v-22h22v50H0Z M214 176v-30h18v-14h20v44Z M268 176v-38h16v-12h24v50Z M330 176v-28h22v-18h18v46Z"
      />
      {/* CN Tower. */}
      <g fill={near}>
        <path d="M200 176 199 88h-3l-1-14h-2l-1-34h-1v34h-2l-1 14h-3l-1 88Z" transform="translate(96 0)" />
        <ellipse cx="300" cy="92" rx="11" ry="5" />
        <rect x="296.5" y="26" width="7" height="14" rx="1" />
      </g>
      {/* Front row. */}
      <path
        fill={near}
        d="M0 176v-28h16v-14h22v42Z M46 176v-40h18v-10h26v50Z M100 176v-24h14v-20h18v44Z M232 176v-34h16v-16h22v50Z M282 176v-22h20v-30h16v52Z M330 176v-38h14v-12h24v50Z M372 176v-26h28v26Z"
      />
      {night ? (
        <g fill="#fde68a" opacity="0.85">
          {[
            [52, 142], [58, 150], [70, 138], [76, 146], [106, 158], [112, 166], [122, 156],
            [238, 152], [246, 160], [256, 148], [290, 140], [296, 150], [306, 132], [338, 148], [350, 156],
            [300, 92],
          ].map(([x, y], i) => (
            <rect key={i} x={x} y={y} width="3" height="3" rx="0.6" />
          ))}
        </g>
      ) : null}
    </g>
  );
}

function Cloud({ x, y, scale = 1, className = '' }: { x: number; y: number; scale?: number; className?: string }) {
  return (
    <g className={className} style={{ transformBox: 'fill-box' }}>
      <g transform={`translate(${x} ${y}) scale(${scale})`} fill="white">
        <ellipse cx="18" cy="10" rx="18" ry="8" />
        <ellipse cx="30" cy="6" rx="12" ry="8" />
        <ellipse cx="8" cy="8" rx="9" ry="6" />
      </g>
    </g>
  );
}

function Train({ night }: { night: boolean }) {
  const windows = (x: number) =>
    [0, 1, 2, 3, 4].map((i) => (
      <rect
        key={i}
        x={x + 5 + i * 10}
        y="152"
        width="7"
        height="6"
        rx="1.4"
        fill={night ? '#fde68a' : '#0c4a6e'}
        opacity={night ? 0.95 : 0.75}
      />
    ));
  return (
    <g>
      {/* Locomotive (front, right-hand side). */}
      <g>
        <path d="M106 147h30a8 8 0 0 1 6 3l6 8v10h-42Z" fill="#f8fafc" />
        <path d="M112 147h24" stroke="#e2e8f0" strokeWidth="1" />
        <rect x="106" y="163" width="42" height="5" fill="#10b981" />
        <path d="M128 151h10l5 6h-15Z" fill={night ? '#fde68a' : '#0c4a6e'} opacity="0.85" />
        <circle cx="146.5" cy="164" r="1.6" fill="#fef08a" />
        {night ? <path d="M148 164h44l-4 8h-40Z" fill="url(#hs-beam)" opacity="0.8" /> : null}
      </g>
      {/* Two coaches. */}
      {[0, 1].map((n) => {
        const x = 2 + n * 52;
        return (
          <g key={n}>
            <rect x={x} y="147" width="50" height="21" rx="3.5" fill="#f8fafc" />
            <rect x={x} y="163" width="50" height="5" fill="#10b981" />
            {windows(x - 1)}
          </g>
        );
      })}
      {/* Couplers and wheels. */}
      <rect x="50" y="160" width="4" height="3" fill="#94a3b8" />
      <rect x="102" y="160" width="4" height="3" fill="#94a3b8" />
      {[14, 40, 66, 92, 118, 134].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="170.5" r="3.4" fill="#0f172a" />
          <circle cx={cx} cy="170.5" r="1.2" fill="#64748b" />
        </g>
      ))}
    </g>
  );
}

function Bus({ night }: { night: boolean }) {
  return (
    <g>
      <rect x="0" y="176" width="52" height="19" rx="4.5" fill="#f97316" />
      <rect x="0" y="188" width="52" height="4" fill="#c2410c" />
      <path d="M40 179h9a3 3 0 0 1 3 3v6H40Z" fill={night ? '#fde68a' : '#0c4a6e'} opacity="0.85" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={5 + i * 9} y="179" width="7" height="6" rx="1.2" fill={night ? '#fde68a' : '#0c4a6e'} opacity="0.8" />
      ))}
      <circle cx="12" cy="195.5" r="4" fill="#0f172a" />
      <circle cx="12" cy="195.5" r="1.4" fill="#94a3b8" />
      <circle cx="41" cy="195.5" r="4" fill="#0f172a" />
      <circle cx="41" cy="195.5" r="1.4" fill="#94a3b8" />
      <circle cx="51.5" cy="187" r="1.4" fill="#fef08a" />
    </g>
  );
}

/**
 * The animated backdrop for the home hero: a sky that follows the time of day,
 * a Toronto skyline, drifting clouds, a GO train on the rails and a bus on the
 * road. Everything is inline SVG + CSS keyframes (no images, no JS per frame),
 * and stops moving for anyone who asked for reduced motion.
 */
export function HeroScene({ phase }: { phase: Phase }) {
  const night = phase === 'night';
  const sky = SKY[phase];
  const sun = SUN[phase];

  return (
    <svg
      aria-hidden
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMax slice"
      className="pointer-events-none absolute inset-0 size-full"
    >
      <defs>
        <linearGradient id="hs-sky" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor={sky.top} />
          <stop offset="1" stopColor={sky.bottom} />
        </linearGradient>
        <radialGradient id="hs-glow">
          <stop offset="0" stopColor={sky.glow} stopOpacity="0.9" />
          <stop offset="1" stopColor={sky.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hs-beam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fef9c3" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fef9c3" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="400" height="200" fill="url(#hs-sky)" />

      {night
        ? STARS.map(([x, y, delay], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="1.2"
              fill="white"
              className="hs-twinkle"
              style={{ animationDelay: `${delay}s` }}
            />
          ))
        : null}

      {/* Sun or moon, with a soft glow that breathes. */}
      <g className="hs-bob">
        <circle cx={sun.x} cy={sun.y} r={sun.r * 3} fill="url(#hs-glow)" className="hs-breathe" />
        <circle cx={sun.x} cy={sun.y} r={sun.r} fill={sun.color} />
        {night ? <circle cx={sun.x + 5} cy={sun.y - 3} r={sun.r * 0.85} fill={SKY.night.top} opacity="0.55" /> : null}
      </g>

      {!night ? (
        <g opacity={phase === 'evening' ? 0.25 : 0.4}>
          <Cloud x={20} y={112} scale={0.9} className="hs-cloud hs-cloud-a" />
          <Cloud x={170} y={100} scale={0.7} className="hs-cloud hs-cloud-b" />
          <Cloud x={280} y={118} scale={0.8} className="hs-cloud hs-cloud-c" />
        </g>
      ) : null}

      <Skyline night={night} />

      {/* Ground, road and rails. */}
      <rect y="174" width="400" height="26" fill={sky.ground} />
      <rect y="174" width="400" height="1.5" fill="rgba(255,255,255,0.18)" />
      <rect y="187" width="400" height="13" fill="rgba(0,0,0,0.35)" />
      {/* Road markings scroll. */}
      <line x1="0" y1="197" x2="400" y2="197" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" strokeDasharray="10 12" className="hs-road" />
      {/* Rails and sleepers. */}
      <line x1="0" y1="172.5" x2="400" y2="172.5" stroke="rgba(226,232,240,0.85)" strokeWidth="1.2" />
      <line x1="0" y1="175.5" x2="400" y2="175.5" stroke="rgba(148,163,184,0.6)" strokeWidth="1" strokeDasharray="2 7" className="hs-sleepers" />

      <g className="hs-train">
        <Train night={night} />
      </g>
      <g className="hs-bus">
        <g transform="translate(52 0) scale(-1 1)">
          <Bus night={night} />
        </g>
      </g>

      {/* Fade the scene into the card below. */}
      <rect y="150" width="400" height="50" fill={sky.ground} opacity="0" />
    </svg>
  );
}
