'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Four looks for the hanging shortcut charm, each on a real pendulum so they can
 * be dragged, flicked and compared. A preview only: tapping reports where the
 * charm would take you rather than navigating away mid-comparison.
 */

const STATIONS = { UN: 'Union Station', BU: 'Burlington' } as const;
type Code = keyof typeof STATIONS;

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
      // Fixed-ish timestep keeps the swing identical on 60Hz and 120Hz screens.
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

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    draggingRef.current = true;
    velocityRef.current = 0;
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!draggingRef.current || !anchorRef.current) return;
      const box = anchorRef.current.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = Math.max(12, event.clientY - box.top);
      const next = Math.atan2(dx, dy);
      const clamped = Math.max(-1.25, Math.min(1.25, next));
      velocityRef.current = (clamped - angleRef.current) * 12;
      angleRef.current = clamped;
      setAngle(clamped);
    },
    [],
  );

  const onPointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return { anchorRef, angle, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

function Hanger({
  length,
  right,
  reduced,
  label,
  onTap,
  thread,
  children,
}: {
  length: number;
  right: number;
  reduced: boolean;
  label: string;
  onTap: () => void;
  thread: string;
  children: React.ReactNode;
}) {
  const { anchorRef, angle, handlers } = useSwing(length, reduced);
  const moved = useRef(false);

  return (
    <div ref={anchorRef} className="absolute top-0" style={{ right }}>
      <div
        className="origin-top"
        style={{ transform: `rotate(${angle}rad)`, willChange: 'transform' }}
      >
        {/* The thread. */}
        <div className="mx-auto w-[2px] rounded-full" style={{ height: length, background: thread }} />
        {/* The charm. */}
        <button
          type="button"
          aria-label={label}
          className="block cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={(e) => {
            moved.current = false;
            handlers.onPointerDown(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons) moved.current = true;
            handlers.onPointerMove(e);
          }}
          onPointerUp={(e) => {
            handlers.onPointerUp();
            if (!moved.current) onTap();
            e.preventDefault();
          }}
          onPointerCancel={handlers.onPointerCancel}
        >
          {children}
        </button>
      </div>
    </div>
  );
}

// ---- the four charms -------------------------------------------------------

function BaggageTag({ code }: { code: Code }) {
  return (
    <svg viewBox="0 0 64 86" className="h-[86px] w-16 drop-shadow-md" aria-hidden>
      <path d="M32 2 58 14v58a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V14L32 2Z" fill="#e8d6ae" stroke="#7a6034" strokeWidth="2" />
      <circle cx="32" cy="16" r="5" fill="#fffaf0" stroke="#7a6034" strokeWidth="2" />
      <rect x="10" y="30" width="44" height="3" fill="#b03a2e" opacity="0.8" />
      <text x="32" y="58" textAnchor="middle" fontSize="22" fontWeight="800" fill="#4a3a1c" fontFamily="ui-monospace, monospace" letterSpacing="1">
        {code}
      </text>
      <text x="32" y="71" textAnchor="middle" fontSize="7" fill="#7a6034" fontFamily="ui-monospace, monospace" letterSpacing="1.4">
        GO RAIL
      </text>
    </svg>
  );
}

function GoFob({ code }: { code: Code }) {
  return (
    <svg viewBox="0 0 62 72" className="h-[72px] w-[62px] drop-shadow-md" aria-hidden>
      <rect x="26" y="0" width="10" height="14" rx="5" fill="none" stroke="#b9c9bd" strokeWidth="3" />
      <circle cx="31" cy="42" r="26" fill="#00853e" stroke="#fff" strokeWidth="3" />
      <circle cx="31" cy="42" r="21" fill="none" stroke="#7dfab8" strokeWidth="1.5" opacity="0.7" />
      <text x="31" y="45" textAnchor="middle" fontSize="17" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
        {code}
      </text>
      <path d="M24 54h14M26 57v2M36 57v2" stroke="#7dfab8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SignalLamp({ code }: { code: Code }) {
  return (
    <svg viewBox="0 0 54 84" className="h-[84px] w-[54px] drop-shadow-md" aria-hidden>
      <path d="M22 2h10v8H22z" fill="#8a6a2f" />
      <path d="M12 12h30l-3 10H15l-3-10Z" fill="#b08d45" stroke="#6d5323" strokeWidth="1.6" />
      <rect x="14" y="22" width="26" height="36" rx="4" fill="#c79b4d" stroke="#6d5323" strokeWidth="1.8" />
      <rect x="19" y="27" width="16" height="24" rx="3" fill="#ffe9a8" />
      <rect x="19" y="27" width="16" height="24" rx="3" fill="#ffd166" opacity="0.85" />
      <text x="27" y="43" textAnchor="middle" fontSize="12" fontWeight="800" fill="#6d4a15" fontFamily="ui-monospace, monospace">
        {code}
      </text>
      <path d="M12 58h30l-3 8H15l-3-8Z" fill="#b08d45" stroke="#6d5323" strokeWidth="1.6" />
      <ellipse cx="27" cy="39" rx="22" ry="17" fill="#ffd166" opacity="0.2" />
    </svg>
  );
}

function LineBeads({ code, color }: { code: Code; color: string }) {
  return (
    <svg viewBox="0 0 44 78" className="h-[78px] w-11 drop-shadow" aria-hidden>
      <circle cx="22" cy="6" r="4" fill="#cbd5e1" />
      <circle cx="22" cy="16" r="3.2" fill="#94a3b8" />
      <circle cx="22" cy="24" r="4" fill="#cbd5e1" />
      <rect x="4" y="30" width="36" height="40" rx="10" fill={color} stroke="#fff" strokeWidth="2.5" />
      <text x="22" y="56" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
        {code}
      </text>
    </svg>
  );
}

// ---- the preview page ------------------------------------------------------

const OPTIONS = [
  { n: 1, name: 'Baggage tag', note: 'Rail luggage tags on string. Warm and characterful.' },
  { n: 2, name: 'GO fob', note: 'Green medallions on a mint cord. Clean and on-brand.' },
  { n: 3, name: 'Signal lamp', note: 'A brass lantern that glows. Lovely at night.' },
  { n: 4, name: 'Line beads', note: 'Beads and flat pendants in the line colours.' },
];

export function DanglePreview() {
  const [reduced, setReduced] = useState(false);
  const [tapped, setTapped] = useState<string | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (!tapped) return;
    const timer = setTimeout(() => setTapped(null), 1800);
    return () => clearTimeout(timer);
  }, [tapped]);

  const tap = (code: Code) => setTapped(`Would open ${STATIONS[code]}`);

  const charm = (n: number, code: Code) => {
    if (n === 1) return <BaggageTag code={code} />;
    if (n === 2) return <GoFob code={code} />;
    if (n === 3) return <SignalLamp code={code} />;
    return <LineBeads code={code} color={code === 'UN' ? '#98002e' : '#0054a6'} />;
  };

  const thread = (n: number) =>
    n === 1 ? '#a08a5e' : n === 2 ? '#7dfab8' : n === 3 ? '#6d5323' : '#94a3b8';

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe pb-24">
      <header className="pt-6 pb-2">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Pick a dangle</h1>
        <p className="mt-1 text-[13px] text-muted">
          Drag each one, flick it, and let it settle. Tap a charm to see where it would take you.
          Tell me the number you want.
        </p>
      </header>

      <div className="space-y-4">
        {OPTIONS.map((option) => (
          <section
            key={option.n}
            className="relative h-[230px] overflow-hidden rounded-2xl border hairline bg-[var(--bg-elevated)]"
          >
            <div className="p-4">
              <p className="text-[11px] font-bold tracking-[0.16em] text-faint uppercase">
                Option {option.n}
              </p>
              <p className="mt-0.5 text-[17px] font-bold">{option.name}</p>
              <p className="mt-1 max-w-[52%] text-[12.5px] text-muted">{option.note}</p>
            </div>

            {/* Two charms, different thread lengths so they swing out of step. */}
            <Hanger
              length={46}
              right={96}
              reduced={reduced}
              label="Union Station shortcut"
              onTap={() => tap('UN')}
              thread={thread(option.n)}
            >
              {charm(option.n, 'UN')}
            </Hanger>
            <Hanger
              length={78}
              right={26}
              reduced={reduced}
              label="Burlington shortcut"
              onTap={() => tap('BU')}
              thread={thread(option.n)}
            >
              {charm(option.n, 'BU')}
            </Hanger>
          </section>
        ))}
      </div>

      {tapped ? (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-4">
          <p className="rounded-full px-4 py-2 text-[13px] font-semibold surface">{tapped}</p>
        </div>
      ) : null}
    </div>
  );
}
