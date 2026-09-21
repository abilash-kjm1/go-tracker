'use client';

/**
 * The cast on the home hero: a cuddly GO train and bus that bob, blink and puff,
 * plus a few stickers tucked around the card. Pure inline SVG and CSS keyframes —
 * nothing here moves in a straight sweep across the card.
 */

const INK = '#07301f';

function Face({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className="gh-blink" style={{ transformOrigin: '0px 0px' }}>
        <ellipse cx="-9" cy="0" rx="3.4" ry="4" fill={INK} />
        <ellipse cx="9" cy="0" rx="3.4" ry="4" fill={INK} />
        <circle cx="-7.8" cy="-1.4" r="1.2" fill="#fff" />
        <circle cx="10.2" cy="-1.4" r="1.2" fill="#fff" />
      </g>
      <ellipse cx="-17" cy="6" rx="4.6" ry="3" fill="#ff9aa8" opacity="0.8" />
      <ellipse cx="17" cy="6" rx="4.6" ry="3" fill="#ff9aa8" opacity="0.8" />
      <path d="M-6 6 q6 6 12 0" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
    </g>
  );
}

function Wheel({ cx, cy, r = 7 }: { cx: number; cy: number; r?: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle r={r} fill={INK} />
      <circle r={r * 0.42} fill="#fef6e4" />
      <g className="gh-wheel" style={{ transformOrigin: '0px 0px' }}>
        <path d={`M0 ${-r * 0.75} V${r * 0.75} M${-r * 0.75} 0 H${r * 0.75}`} stroke="#fef6e4" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
      </g>
    </g>
  );
}

/** A little green GO train, puffing away. */
export function CuteTrain({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 150 116" className={className} fill="none" aria-hidden>
      {/* Puffs rise from the chimney. */}
      <g className="gh-puff">
        <circle cx="36" cy="26" r="7" fill="#fff" opacity="0.9" />
      </g>
      <g className="gh-puff" style={{ animationDelay: '1.1s' }}>
        <circle cx="36" cy="26" r="5" fill="#fff" opacity="0.75" />
      </g>

      <g className="gh-bob">
        {/* Shadow. */}
        <ellipse cx="78" cy="106" rx="52" ry="5" fill={INK} opacity="0.18" />

        {/* Chimney. */}
        <rect x="28" y="34" width="16" height="14" rx="4" fill="#0b7a45" stroke={INK} strokeWidth="2.6" />

        {/* Body. */}
        <rect x="16" y="44" width="118" height="54" rx="20" fill="#12a35c" stroke={INK} strokeWidth="3" />
        {/* Face panel. */}
        <rect x="28" y="52" width="94" height="32" rx="14" fill="#fef6e4" stroke={INK} strokeWidth="2.4" />
        <Face x={75} y={68} />

        {/* Green stripe along the skirt. */}
        <rect x="20" y="88" width="110" height="7" rx="3.5" fill="#7dfab8" opacity="0.9" />

        {/* Headlight. */}
        <circle cx="135" cy="70" r="6.5" fill="#ffe27a" stroke={INK} strokeWidth="2.4" />

        <Wheel cx={44} cy={99} />
        <Wheel cx={106} cy={99} />
      </g>
    </svg>
  );
}

/** A chubby GO bus, in the app's bus orange. */
export function CuteBus({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 132 110" className={className} fill="none" aria-hidden>
      <g className="gh-bob-slow">
        <ellipse cx="66" cy="101" rx="44" ry="4.5" fill={INK} opacity="0.18" />

        {/* Body. */}
        <rect x="12" y="30" width="108" height="62" rx="22" fill="#f98b2b" stroke={INK} strokeWidth="3" />
        {/* Face panel. */}
        <rect x="24" y="40" width="84" height="30" rx="13" fill="#fef6e4" stroke={INK} strokeWidth="2.4" />
        <Face x={66} y={55} scale={0.92} />

        {/* Destination blind. */}
        <rect x="40" y="74" width="52" height="10" rx="5" fill={INK} opacity="0.85" />
        <rect x="45" y="77" width="42" height="4" rx="2" fill="#ffb81c" opacity="0.9" />

        <Wheel cx={38} cy={93} r={6.5} />
        <Wheel cx={94} cy={93} r={6.5} />
      </g>
    </svg>
  );
}

/** Small decorations tucked into the card's corners. */
export function Stickers() {
  return (
    <>
      <Sticker className="top-[104px] right-5" delay="0s" rotate={-12}>
        <Ticket />
      </Sticker>
      <Sticker className="top-[158px] right-16" delay="0.7s" rotate={-6}>
        <Sparkle />
      </Sticker>
      <Sticker className="top-[206px] right-6" delay="1.3s" rotate={9}>
        <Leaf />
      </Sticker>
    </>
  );
}

function Sticker({
  children,
  className,
  delay,
  rotate,
}: {
  children: React.ReactNode;
  className: string;
  delay: string;
  rotate: number;
}) {
  return (
    <span
      aria-hidden
      className={`gh-float pointer-events-none absolute ${className}`}
      style={{ animationDelay: delay, ['--tilt' as string]: `${rotate}deg` }}
    >
      {children}
    </span>
  );
}

function Ticket() {
  return (
    <svg viewBox="0 0 34 24" className="h-6 w-8 drop-shadow" fill="none" aria-hidden>
      <path
        d="M4 3h26a2 2 0 0 1 2 2v3a4 4 0 0 0 0 8v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a4 4 0 0 0 0-8V5a2 2 0 0 1 2-2Z"
        fill="#fef6e4"
        stroke={INK}
        strokeWidth="2"
      />
      <path d="M12 6v12" stroke={INK} strokeWidth="1.6" strokeDasharray="2 3" />
      <circle cx="23" cy="12" r="3" fill="#12a35c" />
    </svg>
  );
}

function Leaf() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 drop-shadow" fill="none" aria-hidden>
      <path
        d="M12 2.5 14 8l5-1.5-2.5 4.5 4 2-4 2 2.5 4.5L14 18l-2 5.5L10 18l-5 1.5L7.5 15l-4-2 4-2L5 6.5 10 8l2-5.5Z"
        fill="#ff6b5e"
        stroke={INK}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A signal post for the scene between the train and the bus. */
export function CuteSignal({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 30" className={className} fill="none" aria-hidden>
      <rect x="4" y="2" width="12" height="20" rx="6" fill="#0b3b26" stroke={INK} strokeWidth="2" />
      <circle cx="10" cy="8" r="3" fill="#ff6b5e" />
      <circle cx="10" cy="16" r="3" fill="#7dfab8" className="gh-glow" />
      <path d="M10 22v6" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function Sparkle() {
  return (
    <svg viewBox="0 0 22 22" className="size-5 drop-shadow" fill="none" aria-hidden>
      <path d="M11 1.5 13 8l6.5 3-6.5 3-2 6.5-2-6.5L2.5 11 9 8l2-6.5Z" fill="#ffe27a" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
