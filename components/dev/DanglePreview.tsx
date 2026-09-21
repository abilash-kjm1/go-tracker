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

/** A struck metal token that flips end over end. */
function Token({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[86px] drop-shadow-lg" aria-hidden>
      <defs>
        <linearGradient id="tok-face" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#fdf6e3" />
          <stop offset="0.45" stopColor="#d8c48c" />
          <stop offset="1" stopColor="#a8843f" />
        </linearGradient>
        <linearGradient id="tok-shine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="40" fill="url(#tok-face)" stroke="#6f5522" strokeWidth="3" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="#6f5522" strokeWidth="1.5" opacity="0.5" />
      {/* Milled edge. */}
      {Array.from({ length: 36 }, (_, i) => (
        <line
          key={i}
          x1="50"
          y1="11"
          x2="50"
          y2="15"
          stroke="#6f5522"
          strokeWidth="1.6"
          opacity="0.55"
          transform={`rotate(${i * 10} 50 50)`}
        />
      ))}
      <text x="50" y="57" textAnchor="middle" fontSize="26" fontWeight="800" fill="#4a3612" fontFamily="ui-monospace, monospace" letterSpacing="1">
        {station.code}
      </text>
      <text x="50" y="72" textAnchor="middle" fontSize="7.5" fill="#6f5522" fontFamily="ui-monospace, monospace" letterSpacing="2">
        GO RAIL
      </text>
      <path d="M50 10a40 40 0 0 0-40 40h14a26 26 0 0 1 26-26Z" fill="url(#tok-shine)" />
    </svg>
  );
}

/** A station-board roller that turns on its side, flipping the code past. */
function Roller({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[86px] drop-shadow-lg" aria-hidden>
      <defs>
        <linearGradient id="rol-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b3442" />
          <stop offset="0.18" stopColor="#0d141d" />
          <stop offset="0.5" stopColor="#151f2b" />
          <stop offset="0.82" stopColor="#0d141d" />
          <stop offset="1" stopColor="#2b3442" />
        </linearGradient>
      </defs>
      <rect x="10" y="26" width="80" height="48" rx="10" fill="url(#rol-body)" stroke="#000" strokeWidth="2" />
      {/* End caps, so it reads as a cylinder. */}
      <rect x="6" y="30" width="7" height="40" rx="3.5" fill="#94a3b8" />
      <rect x="87" y="30" width="7" height="40" rx="3.5" fill="#94a3b8" />
      <text x="50" y="58" textAnchor="middle" fontSize="24" fontWeight="800" fill="#ffb81c" fontFamily="ui-monospace, monospace" letterSpacing="1.5">
        {station.code}
      </text>
      {/* The hinge across the middle of a flap. */}
      <line x1="12" y1="50" x2="88" y2="50" stroke="#000" strokeWidth="1.6" opacity="0.8" />
      <rect x="10" y="26" width="80" height="20" rx="10" fill="#fff" opacity="0.05" />
    </svg>
  );
}

/** A brass compass whose needle sweeps round and settles. */
function Compass({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[86px] drop-shadow-lg" aria-hidden>
      <defs>
        <radialGradient id="cmp-face" cx="0.35" cy="0.3">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="1" stopColor="#e6d5ad" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="42" fill="#b98f3e" stroke="#6d5323" strokeWidth="3" />
      <circle cx="50" cy="50" r="34" fill="url(#cmp-face)" stroke="#6d5323" strokeWidth="1.5" />
      {['N', 'E', 'S', 'W'].map((letter, i) => (
        <text
          key={letter}
          x="50"
          y="24"
          textAnchor="middle"
          fontSize="8"
          fontWeight="700"
          fill="#6d5323"
          fontFamily="system-ui, sans-serif"
          transform={`rotate(${i * 90} 50 50)`}
        >
          {letter}
        </text>
      ))}
      <path d="M50 26 57 50 50 46 43 50Z" fill={station.color} />
      <path d="M50 74 43 50 50 54 57 50Z" fill="#7b8794" />
      <circle cx="50" cy="50" r="4" fill="#6d5323" />
      <rect x="31" y="58" width="38" height="16" rx="8" fill="#6d5323" />
      <text x="50" y="70" textAnchor="middle" fontSize="11" fontWeight="800" fill="#ffe9b8" fontFamily="ui-monospace, monospace">
        {station.code}
      </text>
    </svg>
  );
}

/** A faceted gem in the line's colour, glinting as it turns. */
function Prism({ station }: { station: (typeof STATIONS)[number] }) {
  return (
    <svg viewBox="0 0 100 100" className="size-[86px] drop-shadow-lg" aria-hidden>
      <defs>
        <linearGradient id="gem-l" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M50 8 84 34 71 86H29L16 34Z" fill={station.color} stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M50 8 71 86 50 60 29 86Z" fill="#000" opacity="0.18" />
      <path d="M50 8 16 34l34 26Z" fill="url(#gem-l)" />
      <path d="M16 34h68" stroke="#fff" strokeWidth="1.6" opacity="0.45" />
      <text x="50" y="52" textAnchor="middle" fontSize="20" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
        {station.code}
      </text>
    </svg>
  );
}

// ---- the preview page ------------------------------------------------------

const OPTIONS = [
  { n: 1, name: 'Struck token', note: 'A milled brass token that flips end over end.', axis: 'y' as const, thread: '#a08a5e' },
  { n: 2, name: 'Board roller', note: 'A station-board cylinder that rolls the code past.', axis: 'x' as const, thread: '#94a3b8' },
  { n: 3, name: 'Compass', note: 'Brass compass, needle in the line colour.', axis: 'flat' as const, thread: '#6d5323' },
  { n: 4, name: 'Line gem', note: 'A faceted gem that turns and glints.', axis: 'y' as const, thread: '#cbd5e1' },
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
    if (n === 1) return <Token station={station} />;
    if (n === 2) return <Roller station={station} />;
    if (n === 3) return <Compass station={station} />;
    return <Prism station={station} />;
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
