'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Which stations the hanging signal lamp steps through, and whether it shows at
 * all. Chosen in More; when nothing is chosen the lamp falls back to favourites,
 * and then to Union, so it always points somewhere real.
 */

const STOPS_KEY = 'gotracker:dangle-stops:v1';
const HIDDEN_KEY = 'gotracker:dangle:v1';
const EVENT = 'gotracker:dangle-changed';

export interface DangleStop {
  id: string;
  name: string;
}

function read(): DangleStop[] {
  try {
    const raw = localStorage.getItem(STOPS_KEY);
    return raw ? (JSON.parse(raw) as DangleStop[]) : [];
  } catch {
    return [];
  }
}

function write(stops: DangleStop[]) {
  try {
    localStorage.setItem(STOPS_KEY, JSON.stringify(stops));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

export function useDangleStops() {
  const [stops, setStops] = useState<DangleStop[]>([]);
  const [hidden, setHiddenState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      setStops(read());
      try {
        setHiddenState(localStorage.getItem(HIDDEN_KEY) === 'off');
      } catch {
        setHiddenState(false);
      }
    };
    sync();
    setReady(true);
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const add = useCallback((stop: DangleStop) => {
    const next = read();
    if (next.some((s) => s.id === stop.id)) return;
    // Four is as many as anyone wants to tap through.
    write([...next, stop].slice(0, 4));
  }, []);

  const remove = useCallback((id: string) => {
    write(read().filter((s) => s.id !== id));
  }, []);

  const setHidden = useCallback((value: boolean) => {
    try {
      localStorage.setItem(HIDDEN_KEY, value ? 'off' : 'on');
      window.dispatchEvent(new Event(EVENT));
    } catch {
      // Storage unavailable: honour the choice for this session.
    }
    setHiddenState(value);
  }, []);

  return { stops, hidden, ready, add, remove, setHidden };
}
