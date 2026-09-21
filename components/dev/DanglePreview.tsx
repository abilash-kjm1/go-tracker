'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Four looks for the hanging shortcut, each a single charm on a real pendulum.
 *
 * Drag to swing it. Tap to spin it to the next station. Press and hold to open
 * the station showing. A preview only: holding reports where it would go rather
 * than navigating away mid-comparison.
 */

const STATIONS = [
  { code: 'UN', name: 'Union Station', color: '#00853e' },
  { code: 'BU', name: 'Burlington', color: '#98002e' },
  { code: 'OA', name: 'Oakville', color: '#0054a6' },
] as const;

const HOLD_MS = 520;

/**
 * A damped pendulum. Gravity pulls the charm back to vertical, friction bleeds
 * the swing away, and dragging drives the angle straight from the pointer while
 * recording the speed to hand back on release.
 */
function useSwing(lengthPx: number, reduced: boolean) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);
  const velocityRef = useRef(0);
  const draggingRef = useRef(false);
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      // Capped timestep keeps the swing identical on 60Hz and 120Hz screens.
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;

      if (!draggingRef.current) {
        const gravity = 2400 / lengthPx;
        const acceleration = -gravity * Math.sin(angleRef.current) - 1.6 * velocityRef.current;
        velocityRef.current += acceleration * dt;
        angleRef.current += velocityRef.current * dt;

        // A breath of movement so it never looks frozen.
        if (!reduced && Math.abs(velocityRef.current) < 0.05 && Math.abs(angleRef.current) < 0.04) {
          velocityRef.current += Math.sin(now / 1400) * 0.004;
        }
        setAngle(angleRef.current);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [lengthPx, reduced]);

  const start = useCallback(() => {
    draggingRef.current = true;
    velocityRef.current = 0;
  }, []);

  const move = useCallback((clientX: number, clientY: number) => {
    if (!draggingRef.current || !anchorRef.current) return;
    const box = anchorRef.current.getBoundingClientRect();
    const dx = clientX - (box.left + box.width / 2);
    const dy = Math.max(12, clientY - box.top);
    const next = Math.max(-1.25, Math.min(1.25, Math.atan2(dx, dy)));
    velocityRef.current = (next - angleRef.current) * 12;
    angleRef.current = next;
    setAngle(next);
  }, []);

  const release = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return { anchorRef, angle, start, move, release };
}

/**
 * One charm on a thread. Owns the gestures: drag to swing, tap to spin to the
 * next station, hold to open the one showing.
 */
function Hanger({
  length,
  right,
  reduced,
  thread,
  render,
  onOpen,
  axis = 'y',
}: {
  length: number;
  right: number;
  reduced: boolean;
  thread: string;
  render: (station: (typeof STATIONS)[number]) => React.ReactNode;
  onOpen: (station: (typeof STATIONS)[number]) => void;
  /** Which way the charm turns when tapped. */
  axis?: 'x' | 'y' | 'flat';
}) {
  const { anchorRef, angle, start, move, release } = useSwing(length, reduced);
  const [index, setIndex] = useState(0);
  const [turns, setTurns] = useState(0);
  const [holding, setHolding] = useState(false);

  const movedRef = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedRef = useRef(false);
  const station = STATIONS[index % STATIONS.length];

  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHolding(false);
  };

  const onDown = (event: React.PointerEvent) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    movedRef.current = false;
    openedRef.current = false;
    start();
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      if (movedRef.current) return;
      openedRef.current = true;
      setHolding(false);
      try {
        navigator.vibrate?.(30);
      } catch {
        // No vibration on iOS; the visual ring is the feedback.
      }
      onOpen(station);
    }, HOLD_MS);
  };

  const onMove = (event: React.PointerEvent) => {
    if (!event.buttons && event.pointerType === 'mouse') return;
    if (Math.abs(event.movementX) + Math.abs(event.movementY) > 2) {
      movedRef.current = true;
      clearHold();
    }
    move(event.clientX, event.clientY);
  };

  const onUp = () => {
    release();
    clearHold();
    // A tap that neither dragged nor held is a request to spin.
    if (!movedRef.current && !openedRef.current) {
      setTurns((t) => t + 1);
      setTimeout(() => setIndex((i) => i + 1), reduced ? 0 : 260);
    }
  };

  const spin =
    axis === 'y'
      ? `rotateY(${turns * 360}deg)`
      : axis === 'x'
        ? `rotateX(${turns * 360}deg)`
        : `rotate(${turns * 360}deg)`;

  return (
    <div ref={anchorRef} className="absolute top-0" style={{ right }}>
      <div className="origin-top" style={{ transform: `rotate(${angle}rad)`, willChange: 'transform' }}>
        <div className="mx-auto w-[2px] rounded-full" style={{ height: length, background: thread }} />
        <button
          type="button"
          aria-label={`${station.name} shortcut. Tap to change station, press and hold to open.`}
          className="relative block cursor-grab touch-none select-none active:cursor-grabbing"
          style={{ perspective: 600 }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            release();
            clearHold();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            style={{
              transform: spin,
              transformStyle: 'preserve-3d',
              transition: reduced ? undefined : 'transform 0.52s cubic-bezier(0.3, 0, 0.2, 1)',
            }}
          >
            {render(station)}
          </div>

          {/* The hold ring fills to show the shortcut is about to open. */}
          <svg
            viewBox="0 0 100 100"
            className="pointer-events-none absolute inset-0 size-full"
            fill="none"
            aria-hidden
          >
            <circle
              cx="50"
              cy="50"
              r="46"
              stroke={station.color}
              strokeWidth="4"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={holding ? 0 : 1}
              opacity={holding ? 0.95 : 0}
              style={{ transition: holding ? `stroke-dashoffset ${HOLD_MS}ms linear` : 'opacity 0.2s' }}
              transform="rotate(-90 50 50)"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ---- the four charms -------------------------------------------------------

/**
 * Engraved lettering: a dark cut with a light lip below it, which is what makes
 * type read as machined into a surface rather than printed on top.
 */
function Engraved({
  children,
  y,
  size,
  dark,
  light,
  family = 'ui-monospace, SFMono-Regular, monospace',
  spacing = 1,
}: {
  children: string;
  y: number;
  size: number;
  dark: string;
  light: string;
  family?: string;
  spacing?: number;
}) {
  return (
    <g textAnchor="middle" fontFamily={family} fontWeight={700} letterSpacing={spacing}>
      <text x="50" y={y + 1.1} fontSize={size} fill={light} opacity="0.55">
        {children}
      </text>
      <text x="50" y={y} fontSize={size} fill={dark}>
        {children}
      </text>
    </g>
  );
}

/** Anodised aluminium, brushed and laser-etched. */
function MachinedTag({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[92px]" aria-hidden>
      <defs>
        <linearGradient id="mt-body" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor="#fbfcfd" />
          <stop offset="0.12" stopColor="#d9dee5" />
          <stop offset="0.34" stopColor="#aab2bd" />
          <stop offset="0.52" stopColor="#eef1f5" />
          <stop offset="0.7" stopColor="#9aa3af" />
          <stop offset="0.88" stopColor="#c3cad3" />
          <stop offset="1" stopColor="#848d99" />
        </linearGradient>
        <linearGradient id="mt-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#5b6472" stopOpacity="0.8" />
        </linearGradient>
        {/* Brushed grain: fine noise stretched sideways. */}
        <filter id="mt-brush" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 1.4" numOctaves="2" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.16" intercept="0" />
          </feComponentTransfer>
        </filter>
        <clipPath id="mt-clip">
          <rect x="21" y="12" width="58" height="76" rx="15" />
        </clipPath>
      </defs>

      <rect x="21" y="14" width="58" height="76" rx="15" fill="#39404a" opacity="0.35" />
      <rect x="21" y="12" width="58" height="76" rx="15" fill="url(#mt-body)" />
      <g clipPath="url(#mt-clip)">
        <rect x="21" y="12" width="58" height="76" filter="url(#mt-brush)" />
      </g>
      <rect x="21" y="12" width="58" height="76" rx="15" fill="none" stroke="url(#mt-rim)" strokeWidth="1.6" />

      {/* Fixing hole, with its own shadow inside. */}
      <circle cx="50" cy="24" r="5.4" fill="#6b7480" />
      <circle cx="50" cy="24.8" r="5.4" fill="#0f1319" opacity="0.5" />
      <circle cx="50" cy="24" r="5.4" fill="none" stroke="#eef1f5" strokeWidth="1.2" opacity="0.85" />

      <Engraved y={58} size={23} dark="#454c57" light="#ffffff" spacing={1.5}>
        {station.code}
      </Engraved>
      <Engraved y={74} size={6.5} dark="#5a626d" light="#ffffff" spacing={3}>
        GO TRACKER
      </Engraved>
    </svg>
  );
}

/** Hard enamel in a polished gold cloison. */
function EnamelPin({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[92px]" aria-hidden>
      <defs>
        <linearGradient id="ep-gold" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#fff4c9" />
          <stop offset="0.22" stopColor="#e6bd63" />
          <stop offset="0.45" stopColor="#a87b28" />
          <stop offset="0.62" stopColor="#f6dd97" />
          <stop offset="0.82" stopColor="#c2913a" />
          <stop offset="1" stopColor="#8a6420" />
        </linearGradient>
        <radialGradient id="ep-enamel" cx="0.34" cy="0.26" r="0.85">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="0.28" stopColor={station.color} />
          <stop offset="1" stopColor="#000000" stopOpacity="0.55" />
        </radialGradient>
        <linearGradient id="ep-gloss" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <ellipse cx="50" cy="90" rx="26" ry="4" fill="#0b0f16" opacity="0.28" />
      <circle cx="50" cy="50" r="41" fill="url(#ep-gold)" />
      <circle cx="50" cy="50" r="41" fill="none" stroke="#7a5716" strokeWidth="1.2" opacity="0.7" />
      <circle cx="50" cy="50" r="33.5" fill={station.color} />
      <circle cx="50" cy="50" r="33.5" fill="url(#ep-enamel)" />
      {/* The cloison: a raised gold rib holding the enamel. */}
      <circle cx="50" cy="50" r="33.5" fill="none" stroke="url(#ep-gold)" strokeWidth="2.6" />
      <circle cx="50" cy="50" r="27" fill="none" stroke="url(#ep-gold)" strokeWidth="1.4" opacity="0.75" />

      <text
        x="50"
        y="58"
        textAnchor="middle"
        fontSize="23"
        fontWeight="800"
        fill="url(#ep-gold)"
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="0.5"
      >
        {station.code}
      </text>

      {/* Glaze: a hard gloss crescent, the giveaway of real enamel. */}
      <path d="M50 17a33.5 33.5 0 0 0-33.5 33.5c0 4 .7 7.8 2 11.3C14 43 29 27 50 27Z" fill="url(#ep-gloss)" />
      <circle cx="50" cy="50" r="41" fill="none" stroke="#fff" strokeWidth="0.8" opacity="0.35" />
    </svg>
  );
}

/** Smoked glass with the code lit from inside. */
function GlassDisc({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[92px]" aria-hidden>
      <defs>
        <radialGradient id="gd-body" cx="0.38" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#4a5566" />
          <stop offset="0.45" stopColor="#1b2330" />
          <stop offset="1" stopColor="#070a10" />
        </radialGradient>
        <radialGradient id="gd-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={station.color} stopOpacity="0.95" />
          <stop offset="0.6" stopColor={station.color} stopOpacity="0.18" />
          <stop offset="1" stopColor={station.color} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gd-rim" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="0.75" stopColor="#ffffff" stopOpacity="0.02" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.45" />
        </linearGradient>
        <filter id="gd-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
      </defs>

      <ellipse cx="50" cy="91" rx="24" ry="3.6" fill="#000" opacity="0.32" />
      <circle cx="50" cy="50" r="40" fill="url(#gd-body)" />
      <circle cx="50" cy="50" r="26" fill="url(#gd-core)" filter="url(#gd-soft)" />
      <circle cx="50" cy="50" r="27" fill="none" stroke={station.color} strokeWidth="1.6" opacity="0.65" />

      <text
        x="50"
        y="58"
        textAnchor="middle"
        fontSize="23"
        fontWeight="700"
        fill="#ffffff"
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="1.5"
        opacity="0.96"
      >
        {station.code}
      </text>

      {/* Rim light, and the caustic where light leaves the far side. */}
      <circle cx="50" cy="50" r="40" fill="none" stroke="url(#gd-rim)" strokeWidth="2.2" />
      <path d="M22 66a40 40 0 0 0 46 20" stroke={station.color} strokeWidth="3" opacity="0.4" fill="none" filter="url(#gd-soft)" />
      <path d="M31 25a40 40 0 0 1 22-11" stroke="#fff" strokeWidth="2.6" opacity="0.55" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Burnished leather with a brass plate. */
function LeatherFob({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[92px]" aria-hidden>
      <defs>
        <linearGradient id="lf-hide" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#8a4a26" />
          <stop offset="0.35" stopColor="#6d3618" />
          <stop offset="0.75" stopColor="#4e2410" />
          <stop offset="1" stopColor="#31160a" />
        </linearGradient>
        <linearGradient id="lf-brass" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#fbeab4" />
          <stop offset="0.3" stopColor="#d3ae5c" />
          <stop offset="0.55" stopColor="#8f6c22" />
          <stop offset="0.78" stopColor="#e8cf87" />
          <stop offset="1" stopColor="#7c5c1c" />
        </linearGradient>
        <filter id="lf-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.22" />
          </feComponentTransfer>
        </filter>
        <clipPath id="lf-clip">
          <rect x="20" y="12" width="60" height="78" rx="13" />
        </clipPath>
      </defs>

      <rect x="20" y="15" width="60" height="78" rx="13" fill="#1a0c05" opacity="0.4" />
      <rect x="20" y="12" width="60" height="78" rx="13" fill="url(#lf-hide)" />
      <g clipPath="url(#lf-clip)">
        <rect x="20" y="12" width="60" height="78" filter="url(#lf-grain)" />
      </g>
      {/* Burnished edge and saddle stitching. */}
      <rect x="20" y="12" width="60" height="78" rx="13" fill="none" stroke="#241006" strokeWidth="2.4" />
      <rect
        x="25.5"
        y="17.5"
        width="49"
        height="67"
        rx="9"
        fill="none"
        stroke="#f0d9a8"
        strokeWidth="1.5"
        strokeDasharray="4 3.6"
        opacity="0.75"
      />

      {/* Brass plate, sunk into the leather. */}
      <rect x="29" y="40" width="42" height="27" rx="6" fill="#170a04" opacity="0.55" />
      <rect x="29" y="38.5" width="42" height="27" rx="6" fill="url(#lf-brass)" />
      <rect x="29" y="38.5" width="42" height="27" rx="6" fill="none" stroke="#5f440f" strokeWidth="0.9" opacity="0.8" />
      <Engraved y={58} size={17} dark="#4a350c" light="#fff6d8" family="system-ui, sans-serif" spacing={0.8}>
        {station.code}
      </Engraved>

      {/* Rivet at the hanging point. */}
      <circle cx="50" cy="24" r="6" fill="url(#lf-brass)" stroke="#5f440f" strokeWidth="1" />
      <circle cx="50" cy="24" r="2.2" fill="#3d2b08" opacity="0.6" />
    </svg>
  );
}

// ---- the preview page ------------------------------------------------------

const OPTIONS = [
  { n: 1, name: 'Machined tag', note: 'Brushed anodised aluminium, laser-etched.', axis: 'y' as const, thread: '#9aa3af' },
  { n: 2, name: 'Enamel pin', note: 'Hard enamel set in polished gold.', axis: 'y' as const, thread: '#c2913a' },
  { n: 3, name: 'Smoked glass', note: 'Dark glass, lit from inside.', axis: 'y' as const, thread: '#64748b' },
  { n: 4, name: 'Leather fob', note: 'Stitched hide with a sunk brass plate.', axis: 'flat' as const, thread: '#6d3618' },
];

export function DanglePreview() {
  const [reduced, setReduced] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  const charm = (n: number, station: (typeof STATIONS)[number]) => {
    if (n === 1) return <MachinedTag station={station} />;
    if (n === 2) return <EnamelPin station={station} />;
    if (n === 3) return <GlassDisc station={station} />;
    return <LeatherFob station={station} />;
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe pb-24">
      <header className="pt-6 pb-2">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Pick a dangle</h1>
        <p className="mt-1 text-[13px] text-muted">
          <strong>Drag</strong> to swing it. <strong>Tap</strong> to turn it to the next station.{' '}
          <strong>Press and hold</strong> to open that station. Tell me the number you want.
        </p>
      </header>

      <div className="space-y-4">
        {OPTIONS.map((option) => (
          <section
            key={option.n}
            className="relative h-[240px] overflow-hidden rounded-2xl border hairline bg-[var(--bg-elevated)]"
          >
            <div className="p-4">
              <p className="text-[11px] font-bold tracking-[0.16em] text-faint uppercase">
                Option {option.n}
              </p>
              <p className="mt-0.5 text-[17px] font-bold">{option.name}</p>
              <p className="mt-1 max-w-[50%] text-[12.5px] text-muted">{option.note}</p>
            </div>

            <Hanger
              length={62}
              right={44}
              reduced={reduced}
              thread={option.thread}
              axis={option.axis}
              render={(station) => charm(option.n, station)}
              onOpen={(station) => setToast(`Would open ${station.name}`)}
            />
          </section>
        ))}
      </div>

      {toast ? (
        <div className="fixed inset-x-0 bottom-28 z-40 flex justify-center px-4">
          <p className="rounded-full px-4 py-2 text-[13px] font-semibold surface">{toast}</p>
        </div>
      ) : null}
    </div>
  );
}
