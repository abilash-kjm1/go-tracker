'use client';

import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const KEY = 'gotracker:theme';

export function applyTheme(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function resolvedTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    let pref: ThemePreference = 'system';
    try {
      const stored = localStorage.getItem(KEY) as ThemePreference | null;
      if (stored === 'light' || stored === 'dark' || stored === 'system') pref = stored;
    } catch {
      // ignore
    }
    setPreference(pref);
    setResolved(resolvedTheme(pref));

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(resolvedTheme(pref));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const update = useCallback((pref: ThemePreference) => {
    setPreference(pref);
    applyTheme(pref);
    setResolved(resolvedTheme(pref));
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      // ignore
    }
  }, []);

  return { preference, resolved, setPreference: update };
}

/** Inlined in <head> so the first paint already has the right colours. */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
