/**
 * Basemap styles.
 *
 * VersaTiles serves OpenStreetMap-based vector tiles with no API key and no
 * sign-up, and ships both a light and a genuinely dark style — so dark mode is
 * a real map rather than an inverted light one. Attribution is carried inside
 * each style and rendered by MapLibre's attribution control.
 *
 * Override either style with NEXT_PUBLIC_MAP_STYLE_LIGHT / _DARK (for example
 * to point at a keyed provider like Maptiler or Mapbox in production).
 */

const DEFAULT_LIGHT = 'https://tiles.versatiles.org/assets/styles/neutrino/style.json';
const DEFAULT_DARK = 'https://tiles.versatiles.org/assets/styles/eclipse/style.json';

export function basemapStyleUrl(theme: 'light' | 'dark'): string {
  if (theme === 'dark') return process.env.NEXT_PUBLIC_MAP_STYLE_DARK || DEFAULT_DARK;
  return process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT || DEFAULT_LIGHT;
}

/** Painted behind the tiles so the pane never flashes white in dark mode. */
export const basemapBackground = (theme: 'light' | 'dark') =>
  theme === 'dark' ? '#0b0f17' : '#eef1f6';

/** Greater Toronto and Hamilton Area, where GO operates. */
export const GTHA_CENTER: [number, number] = [-79.55, 43.71];
export const GTHA_BOUNDS: [[number, number], [number, number]] = [
  [-81.2, 42.8],
  [-77.6, 44.6],
];
