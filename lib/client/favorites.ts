'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VehicleType } from '@/lib/transit/types';

/**
 * Favourites live in localStorage — no account, no server round-trip. Every
 * read and write is guarded: private windows and blocked site data must not
 * break the app.
 */

export type FavoriteKind = 'stop' | 'route' | 'trip';

export interface Favorite {
  kind: FavoriteKind;
  id: string;
  name: string;
  subtitle?: string;
  vehicleType?: VehicleType;
  addedAt: number;
}

const KEY = 'gotracker:favorites:v1';
const EVENT = 'gotracker:favorites-changed';

function read(): Favorite[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Favorite[]) : [];
  } catch {
    return [];
  }
}

function write(list: Favorite[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable — favourites stay in memory for this session only.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export const favoriteKey = (kind: FavoriteKind, id: string) => `${kind}:${id}`;

export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setFavorites(read());
    sync();
    setReady(true);
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const isFavorite = useCallback(
    (kind: FavoriteKind, id: string) => favorites.some((f) => f.kind === kind && f.id === id),
    [favorites],
  );

  const toggle = useCallback((fav: Omit<Favorite, 'addedAt'>) => {
    const list = read();
    const existing = list.findIndex((f) => f.kind === fav.kind && f.id === fav.id);
    if (existing >= 0) list.splice(existing, 1);
    else list.unshift({ ...fav, addedAt: Date.now() });
    write(list);
  }, []);

  const remove = useCallback((kind: FavoriteKind, id: string) => {
    write(read().filter((f) => !(f.kind === kind && f.id === id)));
  }, []);

  return { favorites, ready, isFavorite, toggle, remove };
}

/** Recently viewed stops, used on the home screen before anything is starred. */
const RECENT_KEY = 'gotracker:recent-stops:v1';

export function pushRecentStop(stop: { id: string; name: string }) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list: Array<{ id: string; name: string }> = raw ? JSON.parse(raw) : [];
    const next = [stop, ...list.filter((s) => s.id !== stop.id)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function useRecentStops() {
  const [recent, setRecent] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      setRecent(raw ? JSON.parse(raw) : []);
    } catch {
      setRecent([]);
    }
  }, []);
  return recent;
}
