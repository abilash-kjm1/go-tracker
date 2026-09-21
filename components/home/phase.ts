'use client';

import { useEffect, useState } from 'react';
import { torontoParts } from '@/lib/transit/time';

export type Phase = 'morning' | 'day' | 'evening' | 'night';

/** Where the sun is in Toronto right now. */
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
