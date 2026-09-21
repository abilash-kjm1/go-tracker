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

/**
 * A platform clock, and it keeps real time: the second hand sweeps as you watch.
 * The red lollipop hand is the one every station clock in Europe uses.
 */
function PlatformClock({ station }: { station: (typeof STATIONS)[number] }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;

  return (
    <svg viewBox="0 0 100 100" className="size-[92px]" aria-hidden>
      <defs>
        <linearGradient id="pc-bezel" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#fdfefe" />
          <stop offset="0.2" stopColor="#c3cad3" />
          <stop offset="0.42" stopColor="#7d8794" />
          <stop offset="0.6" stopColor="#eef2f6" />
          <stop offset="0.82" stopColor="#8d96a2" />
          <stop offset="1" stopColor="#5c6572" />
        </linearGradient>
        <radialGradient id="pc-dial" cx="0.38" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.75" stopColor="#f4f1e9" />
          <stop offset="1" stopColor="#ddd8cb" />
        </radialGradient>
        <linearGradient id="pc-glass" x1="0.1" y1="0" x2="0.6" y2="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <ellipse cx="50" cy="92" rx="24" ry="3.4" fill="#0b0f16" opacity="0.26" />
      {/* Hanging lug. */}
      <rect x="45" y="2" width="10" height="10" rx="3" fill="url(#pc-bezel)" stroke="#5c6572" strokeWidth="1" />

      <circle cx="50" cy="52" r="40" fill="url(#pc-bezel)" />
      <circle cx="50" cy="52" r="34" fill="url(#pc-dial)" stroke="#b9b2a2" strokeWidth="0.8" />

      {/* Minute ticks, with heavier marks on the hours. */}
      {Array.from({ length: 60 }, (_, i) => {
        const hour = i % 5 === 0;
        return (
          <line
            key={i}
            x1="50"
            y1={hour ? 22 : 23.5}
            x2="50"
            y2={hour ? 28.5 : 26.5}
            stroke="#1c2029"
            strokeWidth={hour ? 3 : 1.1}
            strokeLinecap="butt"
            transform={`rotate(${i * 6} 50 52)`}
          />
        );
      })}

      <text x="50" y="45" textAnchor="middle" fontSize="6" fill="#8a8371" fontFamily="system-ui, sans-serif" letterSpacing="1.6">
        {station.code}
      </text>

      {/* Hands. */}
      <line x1="50" y1="56" x2="50" y2="34" stroke="#12161d" strokeWidth="4.6" strokeLinecap="round" transform={`rotate(${hours * 30} 50 52)`} />
      <line x1="50" y1="58" x2="50" y2="25" stroke="#12161d" strokeWidth="3" strokeLinecap="round" transform={`rotate(${minutes * 6} 50 52)`} />
      <g transform={`rotate(${seconds * 6} 50 52)`}>
        <line x1="50" y1="60" x2="50" y2="32" stroke="#d01f1f" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="50" cy="30" r="4.2" fill="#d01f1f" />
      </g>
      <circle cx="50" cy="52" r="2.6" fill="#12161d" />

      {/* Glass. */}
      <circle cx="50" cy="52" r="34" fill="url(#pc-glass)" />
      <circle cx="50" cy="52" r="40" fill="none" stroke="#fff" strokeWidth="0.8" opacity="0.4" />
    </svg>
  );
}

/** A cast-iron signal head with a thick glass lens, lit in the line colour. */
function SignalLens({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[92px]" aria-hidden>
      <defs>
        <linearGradient id="sl-iron" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#5b6472" />
          <stop offset="0.35" stopColor="#2f3641" />
          <stop offset="0.7" stopColor="#1a1f27" />
          <stop offset="1" stopColor="#0c0f14" />
        </linearGradient>
        <radialGradient id="sl-lens" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.25" stopColor={station.color} stopOpacity="0.95" />
          <stop offset="0.85" stopColor={station.color} />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <filter id="sl-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      <ellipse cx="50" cy="93" rx="22" ry="3.2" fill="#000" opacity="0.3" />
      <rect x="44" y="2" width="12" height="9" rx="3" fill="url(#sl-iron)" />

      {/* Housing, with the hood that keeps sun off the lens. */}
      <rect x="18" y="20" width="64" height="66" rx="16" fill="url(#sl-iron)" />
      <path d="M14 30a36 20 0 0 1 72 0l-6 4a30 15 0 0 0-60 0Z" fill="#171c23" />
      <path d="M14 30a36 20 0 0 1 72 0" fill="none" stroke="#6b7482" strokeWidth="1.4" opacity="0.7" />

      {/* Bolts around the rim. */}
      {[[26, 36], [74, 36], [26, 74], [74, 74]].map(([cx, cy]) => (
        <circle key={`${cx}`} cx={cx} cy={cy} r="2.4" fill="#0a0d12" stroke="#6b7482" strokeWidth="0.9" />
      ))}

      <circle cx="50" cy="55" r="27" fill={station.color} opacity="0.35" filter="url(#sl-glow)" />
      <circle cx="50" cy="55" r="23" fill="url(#sl-lens)" />
      {/* Fresnel rings, which is what a signal lens actually looks like. */}
      {[18, 13, 8].map((r) => (
        <circle key={r} cx="50" cy="55" r={r} fill="none" stroke="#fff" strokeWidth="0.9" opacity="0.28" />
      ))}
      <circle cx="50" cy="55" r="23" fill="none" stroke="#0a0d12" strokeWidth="2.6" />
      <path d="M36 44a23 23 0 0 1 12-6" stroke="#fff" strokeWidth="3" opacity="0.65" fill="none" strokeLinecap="round" />

      <text x="50" y="59" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif" opacity="0.92">
        {station.code}
      </text>
    </svg>
  );
}

/** A polished cross-section of running rail, cut and etched. */
function RailSection({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[92px]" aria-hidden>
      <defs>
        <linearGradient id="rs-steel" x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0" stopColor="#6d7682" />
          <stop offset="0.18" stopColor="#c9d1da" />
          <stop offset="0.34" stopColor="#8b95a2" />
          <stop offset="0.52" stopColor="#eef2f6" />
          <stop offset="0.7" stopColor="#7c8693" />
          <stop offset="0.86" stopColor="#b7c0cb" />
          <stop offset="1" stopColor="#5a626e" />
        </linearGradient>
        <linearGradient id="rs-cut" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#aeb7c2" />
          <stop offset="1" stopColor="#5d6672" />
        </linearGradient>
      </defs>

      <ellipse cx="50" cy="93" rx="26" ry="3.4" fill="#0b0f16" opacity="0.28" />
      <rect x="45" y="3" width="10" height="9" rx="3" fill="url(#rs-steel)" stroke="#4b535e" strokeWidth="1" />

      {/* Rail profile seen end on: head, web, foot. */}
      <path
        d="M27 16h46a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4h-9a5 5 0 0 0-5 5v26a5 5 0 0 0 5 5h9a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4H27a4 4 0 0 1-4-4v-7a4 4 0 0 1 4-4h9a5 5 0 0 0 5-5V36a5 5 0 0 0-5-5h-9a4 4 0 0 1-4-4v-7a4 4 0 0 1 4-4Z"
        fill="url(#rs-steel)"
        stroke="#3f4753"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* The sawn face is duller than the running surface. */}
      <path d="M41 36h18v30H41z" fill="url(#rs-cut)" opacity="0.85" />
      <circle cx="50" cy="44" r="3.4" fill="#2b323c" />

      <Engraved y={60} size={13} dark="#2b323c" light="#eef2f6" spacing={1}>
        {station.code}
      </Engraved>

      {/* Worn shine along the head, where wheels ride. */}
      <rect x="25" y="17" width="50" height="3.4" rx="1.7" fill="#fff" opacity="0.6" />
      <rect x="25" y="79" width="50" height="2.4" rx="1.2" fill="#fff" opacity="0.25" />
    </svg>
  );
}

/** A vitreous enamel platform sign, hung on two small chains. */
function EnamelSign({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[92px]" aria-hidden>
      <defs>
        <linearGradient id="es-face" x1="0.2" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.3" />
        </linearGradient>
      </defs>

      <ellipse cx="50" cy="90" rx="30" ry="3.4" fill="#0b0f16" opacity="0.26" />

      {/* Chains from the bar down to the sign's eyelets. */}
      <rect x="20" y="8" width="60" height="3.4" rx="1.7" fill="#7b8694" />
      {[30, 70].map((x) => (
        <g key={x} stroke="#94a0ae" strokeWidth="2" fill="none">
          <path d={`M${x} 11v6`} />
          <path d={`M${x} 17v6`} />
        </g>
      ))}

      <rect x="14" y="26" width="72" height="50" rx="7" fill="#20252c" />
      <rect x="15.5" y="27.5" width="69" height="47" rx="6" fill={station.color} />
      <rect x="15.5" y="27.5" width="69" height="47" rx="6" fill="url(#es-face)" />
      {/* The white keyline every enamel sign has. */}
      <rect x="20" y="32" width="60" height="38" rx="4" fill="none" stroke="#fff" strokeWidth="1.8" opacity="0.92" />

      <text
        x="50"
        y="58"
        textAnchor="middle"
        fontSize="22"
        fontWeight="800"
        fill="#fff"
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="1.5"
      >
        {station.code}
      </text>

      {/* Chips at the corners, down to the steel underneath. */}
      <path d="M15.5 33a6 6 0 0 1 4-5l-1 5Z" fill="#20252c" opacity="0.8" />
      <path d="M84.5 70a5 5 0 0 1-4 4.5l.6-4.5Z" fill="#20252c" opacity="0.8" />
      {/* Eyelets. */}
      <circle cx="30" cy="30.5" r="2.2" fill="#20252c" />
      <circle cx="70" cy="30.5" r="2.2" fill="#20252c" />
    </svg>
  );
}

// ---- the preview page ------------------------------------------------------

const OPTIONS = [
  { n: 1, name: 'Platform clock', note: 'A station clock that keeps real time.', axis: 'y' as const, thread: '#8d96a2' },
  { n: 2, name: 'Signal lens', note: 'Cast-iron signal head, glass lit in the line colour.', axis: 'y' as const, thread: '#3a424e' },
  { n: 3, name: 'Rail section', note: 'A cut length of running rail, polished and etched.', axis: 'y' as const, thread: '#8b95a2' },
  { n: 4, name: 'Enamel sign', note: 'A platform sign on two chains.', axis: 'flat' as const, thread: '#7b8694' },
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
    if (n === 1) return <PlatformClock station={station} />;
    if (n === 2) return <SignalLens station={station} />;
    if (n === 3) return <RailSection station={station} />;
    return <EnamelSign station={station} />;
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
