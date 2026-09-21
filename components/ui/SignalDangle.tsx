'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useFavorites } from '@/lib/client/favorites';

/**
 * A signal lamp on an elastic cord, hanging in the top-right corner.
 *
 * It is a spring, not a pendulum: pull it down and the cord stretches, let go
 * and it springs back past the top before settling. Left alone it drifts gently
 * rather than hanging dead still.
 *
 * Tap turns it to the next station and the lamp changes aspect. Press and hold
 * opens that station. It cycles your favourite stops, so starring a station is
 * how you choose what it points at.
 */

const REST_LENGTH = 148;
const MAX_STRETCH = 150;
const HOLD_MS = 520;
const ANCHOR_RIGHT = 38;
const STORAGE_KEY = 'gotracker:dangle:v1';

/** Where the lamp points when nothing is starred yet. */
const FALLBACK = [{ id: 'UN', name: 'Union Station GO' }];

/** Signal aspects, in the order a lamp steps through them. */
const ASPECTS = ['#22c55e', '#ffb81c', '#ef4444', '#38bdf8'];

interface Vec {
  x: number;
  y: number;
}

export function SignalDangle() {
  const router = useRouter();
  const pathname = usePathname();
  const { favorites, ready } = useFavorites();

  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [index, setIndex] = useState(0);
  const [turns, setTurns] = useState(0);
  const [holding, setHolding] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [pos, setPos] = useState<Vec>({ x: 0, y: REST_LENGTH });

  const posRef = useRef<Vec>({ x: 0, y: REST_LENGTH });
  const velRef = useRef<Vec>({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const openedRef = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const stops = (() => {
    const starred = favorites.filter((f) => f.kind === 'stop').map((f) => ({ id: f.id, name: f.name }));
    return starred.length ? starred : FALLBACK;
  })();
  const stop = stops[index % stops.length];
  const aspect = ASPECTS[index % ASPECTS.length];

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    try {
      setHidden(localStorage.getItem(STORAGE_KEY) === 'off');
    } catch {
      // Storage unavailable: the lamp simply shows.
    }
  }, []);

  // ---- the spring --------------------------------------------------------
  useEffect(() => {
    if (reduced || hidden) return;
    let frame = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.03, (now - last) / 1000);
      last = now;

      if (!draggingRef.current) {
        const p = posRef.current;
        const v = velRef.current;
        const dist = Math.max(0.001, Math.hypot(p.x, p.y));
        const stretch = dist - REST_LENGTH;

        // A cord pulls when stretched and does nothing when slack, so a release
        // from below throws the lamp up past its resting point.
        const k = stretch > 0 ? 260 : 0;
        let ax = (-k * stretch * p.x) / dist;
        let ay = (-k * stretch * p.y) / dist + 780;

        // A breath of drift, so it never hangs dead still.
        ax += Math.sin(now / 1700) * 26 + Math.sin(now / 930) * 12;
        ay += Math.cos(now / 2100) * 14;

        ax -= 2.6 * v.x;
        ay -= 2.6 * v.y;

        v.x += ax * dt;
        v.y += ay * dt;
        p.x += v.x * dt;
        p.y += v.y * dt;

        // It can swing wide but never leaves the corner entirely.
        const limit = Math.hypot(p.x, p.y);
        if (limit > REST_LENGTH + MAX_STRETCH) {
          const scale = (REST_LENGTH + MAX_STRETCH) / limit;
          p.x *= scale;
          p.y *= scale;
        }
        setPos({ x: p.x, y: p.y });
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reduced, hidden]);

  // ---- gestures ----------------------------------------------------------
  const clearHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHolding(false);
  };

  const onDown = (event: React.PointerEvent) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    draggingRef.current = true;
    velRef.current = { x: 0, y: 0 };
    movedRef.current = false;
    openedRef.current = false;
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      if (movedRef.current) return;
      openedRef.current = true;
      setHolding(false);
      try {
        navigator.vibrate?.(30);
      } catch {
        // No vibration on iOS; the ring is the feedback.
      }
      router.push(`/stations/${encodeURIComponent(stop.id)}`);
    }, HOLD_MS);
  };

  const onMove = (event: React.PointerEvent) => {
    if (!draggingRef.current || !anchorRef.current) return;
    if (Math.abs(event.movementX) + Math.abs(event.movementY) > 2) {
      movedRef.current = true;
      clearHold();
    }
    const box = anchorRef.current.getBoundingClientRect();
    let x = event.clientX - (box.left + box.width / 2);
    let y = event.clientY - box.top;
    const dist = Math.hypot(x, y);
    const max = REST_LENGTH + MAX_STRETCH;
    if (dist > max) {
      x = (x / dist) * max;
      y = (y / dist) * max;
    }
    const previous = posRef.current;
    velRef.current = { x: (x - previous.x) * 9, y: (y - previous.y) * 9 };
    posRef.current = { x, y };
    setPos({ x, y });
  };

  const onUp = () => {
    draggingRef.current = false;
    clearHold();
    if (!movedRef.current && !openedRef.current) {
      // A tap steps the lamp to the next aspect and the next station.
      setTurns((t) => t + 1);
      setBlinking(true);
      setTimeout(() => {
        setIndex((i) => i + 1);
        setBlinking(false);
      }, 240);
    }
  };

  if (hidden || !ready || pathname.startsWith('/map')) return null;

  const angle = Math.atan2(pos.x, Math.max(1, pos.y)) * (180 / Math.PI);
  const dist = Math.hypot(pos.x, pos.y);
  // A slack cord bows; a stretched one pulls straight.
  const sag = Math.max(0, REST_LENGTH - dist) * 0.7;
  const lit = blinking ? '#2b3138' : aspect;

  return (
    <div
      className="pointer-events-none fixed top-0 right-0 z-30 h-[360px] w-[170px] pt-safe"
      aria-hidden={false}
    >
      {/* The anchor the cord hangs from. */}
      <div ref={anchorRef} className="absolute top-0" style={{ right: ANCHOR_RIGHT, width: 2, height: 2 }} />

      <svg className="absolute inset-0 size-full" fill="none" aria-hidden>
        <path
          d={`M${170 - ANCHOR_RIGHT - 1} 0 Q ${170 - ANCHOR_RIGHT - 1 + pos.x / 2 + sag} ${pos.y / 2} ${170 - ANCHOR_RIGHT - 1 + pos.x} ${pos.y}`}
          stroke="#54606f"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx={170 - ANCHOR_RIGHT - 1} cy="2" r="3.5" fill="#54606f" />
      </svg>

      <button
        type="button"
        aria-label={`${stop.name.replace(/\s+GO(\s+Bus)?$/i, '')} shortcut. Tap to change station, press and hold to open.`}
        className="pointer-events-auto absolute touch-none select-none"
        style={{
          right: ANCHOR_RIGHT - 28,
          top: 0,
          transform: `translate(${pos.x}px, ${pos.y}px) rotate(${angle * 0.55}deg)`,
          transformOrigin: '50% 0%',
          perspective: 600,
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          draggingRef.current = false;
          clearHold();
        }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') router.push(`/stations/${encodeURIComponent(stop.id)}`);
          if (e.key === ' ') {
            e.preventDefault();
            setIndex((i) => i + 1);
          }
        }}
      >
        <div
          style={{
            transform: `rotateY(${turns * 360}deg)`,
            transition: 'transform 0.55s cubic-bezier(0.3, 0, 0.2, 1)',
          }}
        >
          <SignalLamp code={shortCode(stop)} lit={lit} holding={holding} />
        </div>

        {/* The hold ring fills to show the shortcut is about to open. */}
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full" fill="none" aria-hidden>
          <circle
            cx="50"
            cy="56"
            r="34"
            stroke={aspect}
            strokeWidth="5"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={holding ? 0 : 1}
            opacity={holding ? 0.95 : 0}
            style={{ transition: holding ? `stroke-dashoffset ${HOLD_MS}ms linear` : 'opacity 0.2s' }}
            transform="rotate(-90 50 56)"
          />
        </svg>
      </button>
    </div>
  );
}

/** Two or three letters that fit on the lens. */
function shortCode(stop: { id: string; name: string }) {
  if (/^[A-Z]{2,3}$/.test(stop.id)) return stop.id;
  return stop.name.replace(/\s+GO(\s+Bus)?$/i, '').slice(0, 3).toUpperCase();
}

/** The cast-iron signal head, with the lamp alive inside it. */
function SignalLamp({ code, lit, holding }: { code: string; lit: string; holding: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className="size-14 drop-shadow-lg" aria-hidden>
      <defs>
        <linearGradient id="sd-iron" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#5b6472" />
          <stop offset="0.35" stopColor="#2f3641" />
          <stop offset="0.7" stopColor="#1a1f27" />
          <stop offset="1" stopColor="#0c0f14" />
        </linearGradient>
        <radialGradient id="sd-lens" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.25" stopColor={lit} stopOpacity="0.95" />
          <stop offset="0.85" stopColor={lit} />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <filter id="sd-glow" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <clipPath id="sd-lensclip">
          <circle cx="50" cy="56" r="23" />
        </clipPath>
      </defs>

      <rect x="44" y="0" width="12" height="9" rx="3" fill="url(#sd-iron)" />
      <rect x="18" y="21" width="64" height="66" rx="16" fill="url(#sd-iron)" />
      <path d="M14 31a36 20 0 0 1 72 0l-6 4a30 15 0 0 0-60 0Z" fill="#171c23" />
      <path d="M14 31a36 20 0 0 1 72 0" fill="none" stroke="#6b7482" strokeWidth="1.4" opacity="0.7" />
      {[[26, 37], [74, 37], [26, 75], [74, 75]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.4" fill="#0a0d12" stroke="#6b7482" strokeWidth="0.9" />
      ))}

      {/* The lamp itself: a glow that breathes, and flares while held. */}
      <circle
        cx="50"
        cy="56"
        r={holding ? 32 : 27}
        fill={lit}
        opacity={holding ? 0.6 : 0.35}
        filter="url(#sd-glow)"
        className="sd-breathe"
        style={{ transition: 'r 0.25s ease, opacity 0.25s ease' }}
      />
      <circle cx="50" cy="56" r="23" fill="url(#sd-lens)" style={{ transition: 'fill 0.2s linear' }} />
      {[18, 13, 8].map((r) => (
        <circle key={r} cx="50" cy="56" r={r} fill="none" stroke="#fff" strokeWidth="0.9" opacity="0.28" />
      ))}
      {/* A glint crossing the glass now and then. */}
      <g clipPath="url(#sd-lensclip)">
        <rect className="sd-glint" x="-40" y="28" width="18" height="60" fill="#fff" opacity="0.5" transform="rotate(18 50 56)" />
      </g>
      <circle cx="50" cy="56" r="23" fill="none" stroke="#0a0d12" strokeWidth="2.6" />
      <path d="M36 45a23 23 0 0 1 12-6" stroke="#fff" strokeWidth="3" opacity="0.6" fill="none" strokeLinecap="round" />

      <text
        x="50"
        y="61"
        textAnchor="middle"
        fontSize="15"
        fontWeight="800"
        fill="#fff"
        fontFamily="system-ui, -apple-system, sans-serif"
        opacity="0.95"
      >
        {code}
      </text>
    </svg>
  );
}
