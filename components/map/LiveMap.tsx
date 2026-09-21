'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { basemapBackground, basemapStyleUrl, GTHA_BOUNDS, GTHA_CENTER } from './mapStyle';
import { VehicleSheet } from '@/components/vehicles/VehicleSheet';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { ModeIcon } from '@/components/ui/primitives';
import { useTheme } from '@/lib/client/theme';
import { useTransit } from '@/lib/client/useTransit';
import type { LiveVehicle, TransitRoute, TransitStop, VehicleType } from '@/lib/transit/types';

type ModeFilter = 'all' | VehicleType;

interface MarkerEntry {
  marker: Marker;
  el: HTMLElement;
  from: [number, number];
  to: [number, number];
  startedAt: number;
  vehicle: LiveVehicle;
}

const TWEEN_MS = 1400;
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The live map. Vehicles are DOM markers tweened between polls so they glide
 * instead of jumping every 15 seconds; stations are a clustered GeoJSON source
 * so the map stays fast when every stop is shown.
 */
export function LiveMap({ stops, routes }: { stops: TransitStop[]; routes: TransitRoute[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, MarkerEntry>());
  const frameRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<ModeFilter>('all');
  const [routeId, setRouteId] = useState<string>('all');
  const [selected, setSelected] = useState<LiveVehicle | null>(null);
  const [showStations, setShowStations] = useState(true);
  const { resolved } = useTheme();

  // ?trip=<gtfs trip id> arrives from a trip page's "Follow on the live map".
  const params = useSearchParams();
  const followTripId = params.get('trip');
  const [following, setFollowing] = useState<string | null>(followTripId);
  const hasCentredRef = useRef(false);

  const { data: vehicles, meta, freshness, error } = useTransit<LiveVehicle[]>(
    '/api/transit/vehicles/live',
    { intervalMs: 15_000 },
  );

  const visible = useMemo(() => {
    const list = (vehicles ?? []).filter(
      (v) => Number.isFinite(v.latitude) && Number.isFinite(v.longitude),
    );
    return list.filter(
      (v) =>
        // A followed vehicle stays visible whatever the filters say.
        (following && v.tripId === following) ||
        ((mode === 'all' || v.vehicleType === mode) &&
          (routeId === 'all' || v.routeId === routeId)),
    );
  }, [vehicles, mode, routeId, following]);

  /** Only offer filters for services that actually appear in the live data. */
  const activeRoutes = useMemo(() => {
    const ids = new Set((vehicles ?? []).map((v) => v.routeId).filter(Boolean) as string[]);
    return routes.filter((r) => ids.has(r.id));
  }, [vehicles, routes]);

  const activeModes = useMemo(() => {
    const set = new Set((vehicles ?? []).map((v) => v.vehicleType));
    return [...set];
  }, [vehicles]);

  const followed = useMemo(
    () => (following ? (vehicles ?? []).find((v) => v.tripId === following) : undefined),
    [vehicles, following],
  );

  // ---- map setup ---------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyleUrl(resolved),
      center: GTHA_CENTER,
      zoom: 8.4,
      maxBounds: GTHA_BOUNDS,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }),
      'bottom-right',
    );
    map.on('load', () => setReady(true));
    // Labels are useful up close but pile up across the whole GTHA, so markers
    // collapse to their icon when zoomed out.
    const applyDensity = () => {
      const compact = map.getZoom() < 10;
      for (const entry of markersRef.current.values()) {
        entry.el.dataset.compact = compact ? 'true' : 'false';
      }
    };
    map.on('zoomend', applyDensity);
    map.on('load', applyDensity);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Style changes are handled separately so the map is not rebuilt on theme switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setStyle(basemapStyleUrl(resolved));
    // Re-adding sources after a style swap happens on styledata below.
  }, [resolved, ready]);

  // ---- stations ----------------------------------------------------------

  const stationGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: stops.map((s) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
        properties: {
          id: s.id,
          name: s.name,
          isStation: s.modes.includes('train') ? 1 : 0,
        },
      })),
    }),
    [stops],
  );

  const addStationLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || map.getSource('stations')) return;

    map.addSource('stations', {
      type: 'geojson',
      data: stationGeoJson,
      cluster: true,
      clusterRadius: 46,
      clusterMaxZoom: 11,
    });

    map.addLayer({
      id: 'station-clusters',
      type: 'circle',
      source: 'stations',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': resolved === 'dark' ? '#1b2130' : '#ffffff',
        'circle-stroke-color': resolved === 'dark' ? '#7f8b9e' : '#b3bdcc',
        'circle-stroke-width': 1.5,
        'circle-radius': ['step', ['get', 'point_count'], 14, 20, 18, 80, 24],
      },
    });
    map.addLayer({
      id: 'station-cluster-count',
      type: 'symbol',
      source: 'stations',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
      paint: { 'text-color': resolved === 'dark' ? '#eceff4' : '#2a3140' },
    });
    map.addLayer({
      id: 'station-points',
      type: 'circle',
      source: 'stations',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'isStation'], 1], 5.5, 3.5],
        'circle-color': ['case', ['==', ['get', 'isStation'], 1], '#10b981', resolved === 'dark' ? '#7f8b9e' : '#5a6579'],
        'circle-stroke-color': resolved === 'dark' ? '#0b0f17' : '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });

    map.on('click', 'station-points', (e) => {
      const feature = e.features?.[0];
      const id = feature?.properties?.id;
      if (typeof id === 'string') window.location.assign(`/stations/${encodeURIComponent(id)}`);
    });
    map.on('click', 'station-clusters', async (e) => {
      const feature = map.queryRenderedFeatures(e.point, { layers: ['station-clusters'] })[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource('stations') as GeoJSONSource | undefined;
      if (!source || clusterId == null) return;
      const zoom = await source.getClusterExpansionZoom(Number(clusterId));
      map.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
    });
    for (const layer of ['station-points', 'station-clusters']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
  }, [stationGeoJson, resolved]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    addStationLayers();
    const onStyleData = () => addStationLayers();
    map.on('styledata', onStyleData);
    return () => {
      map.off('styledata', onStyleData);
    };
  }, [ready, addStationLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const id of ['station-points', 'station-clusters', 'station-cluster-count']) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', showStations ? 'visible' : 'none');
      }
    }
  }, [showStations, ready]);

  // ---- vehicle markers ---------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const seen = new Set<string>();
    for (const vehicle of visible) {
      seen.add(vehicle.id);
      const target: [number, number] = [vehicle.longitude, vehicle.latitude];
      const existing = markersRef.current.get(vehicle.id);

      if (existing) {
        const current = existing.marker.getLngLat();
        const heading = bearing([current.lng, current.lat], target);
        existing.from = [current.lng, current.lat];
        existing.to = target;
        existing.startedAt = performance.now();
        existing.vehicle = vehicle;
        updateMarkerEl(existing.el, vehicle, heading);
        // Without the tween loop the marker would otherwise never move at all.
        if (prefersReducedMotion()) existing.marker.setLngLat(target);
      } else {
        const el = createMarkerEl(vehicle, map.getZoom() < 10);
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          setSelected(markersRef.current.get(vehicle.id)?.vehicle ?? vehicle);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(target)
          .addTo(map);
        markersRef.current.set(vehicle.id, {
          marker,
          el,
          from: target,
          to: target,
          startedAt: performance.now(),
          vehicle,
        });
      }
    }

    for (const [id, entry] of markersRef.current) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [visible, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !followed) return;
    if (!Number.isFinite(followed.latitude) || !Number.isFinite(followed.longitude)) return;

    const center: [number, number] = [followed.longitude, followed.latitude];
    if (!hasCentredRef.current) {
      // First lock-on: fly in close enough to see which street it is on.
      map.flyTo({ center, zoom: 12.5, duration: 900 });
      hasCentredRef.current = true;
      // Deliberately not opening the detail sheet: it would cover the vehicle
      // we just flew to. The follow chip names it; tapping the marker opens it.
    } else {
      // Only pan once it nears an edge, so the vehicle visibly travels across
      // the frame instead of being pinned while the map slides under it.
      const point = map.project(center);
      const { width, height } = map.getCanvas().getBoundingClientRect();
      const comfortable =
        point.x > width * 0.2 &&
        point.x < width * 0.8 &&
        point.y > height * 0.2 &&
        point.y < height * 0.8;
      if (!comfortable) map.easeTo({ center, duration: 1400 });
    }
  }, [followed, ready]);

  useEffect(() => {
    if (!following) hasCentredRef.current = false;
  }, [following]);

  // Tween markers toward their latest position instead of snapping.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const step = () => {
      const now = performance.now();
      for (const entry of markersRef.current.values()) {
        const t = Math.min(1, (now - entry.startedAt) / TWEEN_MS);
        if (t >= 1) continue;
        const eased = 1 - (1 - t) ** 3;
        entry.marker.setLngLat([
          entry.from[0] + (entry.to[0] - entry.from[0]) * eased,
          entry.from[1] + (entry.to[1] - entry.from[1]) * eased,
        ]);
      }
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const entry of markers.values()) entry.marker.remove();
      markers.clear();
    };
  }, []);

  // ---- chrome ------------------------------------------------------------

  return (
    <div className="relative h-[calc(100dvh-4rem)] w-full md:h-dvh">
      {/* size-full, not absolute: maplibre-gl.css forces position:relative on .maplibregl-map. */}
      <div
        ref={containerRef}
        className="size-full"
        style={{ background: basemapBackground(resolved) }}
        aria-label="Live GO vehicle map"
        role="application"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 space-y-2 p-3 pt-safe">
        <div className="pointer-events-auto flex items-center justify-between gap-2 rounded-2xl px-3 py-2 surface">
          <LiveIndicator freshness={error && !vehicles ? 'unavailable' : freshness} updatedAt={meta?.updatedAt ?? null} />
          <span className="tabular text-xs text-muted">{visible.length} shown</span>
        </div>

        <div className="no-scrollbar pointer-events-auto flex gap-1.5 overflow-x-auto">
          <FilterChip active={mode === 'all'} onClick={() => setMode('all')}>
            All
          </FilterChip>
          {activeModes.map((m) => (
            <FilterChip key={m} active={mode === m} onClick={() => setMode(m)}>
              <ModeIcon type={m} className="size-4" />
              {m === 'train' ? 'Trains' : m === 'bus' ? 'Buses' : 'Other'}
            </FilterChip>
          ))}
          <span className="mx-1 w-px shrink-0 bg-[var(--border)]" aria-hidden />
          <FilterChip active={routeId === 'all'} onClick={() => setRouteId('all')}>
            All services
          </FilterChip>
          {activeRoutes.map((route) => (
            <FilterChip key={route.id} active={routeId === route.id} onClick={() => setRouteId(route.id)}>
              <span className="size-2 rounded-full" style={{ background: route.color ?? '#888' }} aria-hidden />
              {route.name}
            </FilterChip>
          ))}
          <span className="mx-1 w-px shrink-0 bg-[var(--border)]" aria-hidden />
          <FilterChip active={showStations} onClick={() => setShowStations((v) => !v)}>
            Stations
          </FilterChip>
        </div>
      </div>

      {following ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-3.5 text-[13px] surface">
            {followed ? (
              <>
                <span className="live-dot size-2 rounded-full bg-signal-500" aria-hidden />
                <span className="font-semibold">
                  Following {followed.routeName ?? 'service'}
                  {followed.tripNumber ? ` ${followed.tripNumber}` : ''}
                </span>
              </>
            ) : (
              <span className="text-muted">That trip is not reporting a position right now</span>
            )}
            <button
              type="button"
              onClick={() => setFollowing(null)}
              aria-label="Stop following"
              className="grid size-7 place-items-center rounded-full bg-[var(--bg-sunken)] text-[var(--fg-muted)]"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {error && !vehicles ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
          <p className="pointer-events-auto max-w-xs rounded-2xl px-4 py-3 text-center text-[13px] surface">
            <span className="block font-semibold">GO real-time data is temporarily unavailable.</span>
            <span className="mt-1 block text-muted">
              {meta?.updatedAt
                ? `Last successful update ${new Date(meta.updatedAt).toLocaleTimeString()}.`
                : 'Stations and schedules are still available.'}
            </span>
          </p>
        </div>
      ) : null}

      {vehicles && visible.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
          <p className="pointer-events-auto rounded-full px-4 py-2 text-center text-[13px] text-muted surface">
            {vehicles.length === 0
              ? 'No vehicles are reporting positions right now.'
              : 'No vehicles match these filters.'}
          </p>
        </div>
      ) : null}

      <VehicleSheet vehicle={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors hairline',
        active
          ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-transparent'
          : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ---- marker DOM ----------------------------------------------------------

const TRAIN_PATH =
  '<path d="M6 2.5h8a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 14 14.5H6A2.5 2.5 0 0 1 3.5 12V5A2.5 2.5 0 0 1 6 2.5Z" stroke="currentColor" stroke-width="1.4"/><path d="M4 7.5h12" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="11.5" r="1" fill="currentColor"/><circle cx="13" cy="11.5" r="1" fill="currentColor"/>';
const BUS_PATH =
  '<path d="M4.5 4.5h11a1.5 1.5 0 0 1 1.5 1.5v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" stroke-width="1.4"/><path d="M3 8.5h14" stroke="currentColor" stroke-width="1.4"/><circle cx="6.5" cy="12" r="1" fill="currentColor"/><circle cx="13.5" cy="12" r="1" fill="currentColor"/>';

function createMarkerEl(vehicle: LiveVehicle, compact: boolean): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'gt-marker';
  el.dataset.compact = compact ? 'true' : 'false';
  el.style.cssText =
    'display:flex;align-items:center;gap:6px;padding:3px 8px 3px 4px;border-radius:999px;border:1px solid var(--border-strong);background:var(--bg-elevated);box-shadow:var(--shadow-card);font:600 11px/1 var(--font-sans);color:var(--fg);cursor:pointer;transition:transform .15s ease;white-space:nowrap';
  updateMarkerEl(el, vehicle);
  return el;
}

/** Compass bearing between two positions, for the direction-of-travel arrow. */
function bearing(from: [number, number], to: [number, number]): number | null {
  const dLon = to[0] - from[0];
  const dLat = to[1] - from[1];
  // Below this the vehicle has effectively not moved; keep the previous arrow.
  if (Math.abs(dLon) < 1e-5 && Math.abs(dLat) < 1e-5) return null;
  const rad = Math.atan2(dLon * Math.cos((((to[1] + from[1]) / 2) * Math.PI) / 180), dLat);
  return ((rad * 180) / Math.PI + 360) % 360;
}

function updateMarkerEl(el: HTMLElement, vehicle: LiveVehicle, heading?: number | null) {
  const delayMin = vehicle.delaySeconds != null ? Math.round(vehicle.delaySeconds / 60) : 0;
  const late = delayMin >= 1;
  const icon = vehicle.vehicleType === 'bus' ? BUS_PATH : TRAIN_PATH;
  const tint = late ? 'var(--color-warn-500)' : 'var(--color-signal-500)';

  // A train covers about a pixel per poll at regional zoom, so movement needs
  // to be stated, not just animated: an arrow points the way it is heading.
  if (heading != null) el.dataset.heading = String(Math.round(heading));
  const arrowDeg = el.dataset.heading;
  const arrow =
    arrowDeg && vehicle.isMoving
      ? `<span style="position:absolute;top:-5px;left:5px;width:10px;height:10px;transform:rotate(${arrowDeg}deg);color:${tint}">
           <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden><path d="M5 0 L9 9 L5 6.8 L1 9 Z" fill="currentColor"/></svg>
         </span>`
      : '';

  el.innerHTML = `
    <span style="position:relative;display:grid;place-items:center;width:20px;height:20px;border-radius:999px;background:${tint};color:#fff;flex:none">
      <svg viewBox="0 0 20 20" width="13" height="13" fill="none" aria-hidden>${icon}</svg>
      ${arrow}
    </span>
    <span class="gt-marker-label" style="display:flex;flex-direction:column;gap:1px;align-items:flex-start">
      <span>${escapeHtml(vehicle.routeName ?? vehicle.serviceName ?? 'GO')}</span>
      <span style="font-weight:500;color:var(--fg-muted)">${escapeHtml(
        vehicle.destination ?? '',
      )}${late ? ` · +${delayMin}` : ''}</span>
    </span>`;
  el.setAttribute(
    'aria-label',
    `${vehicle.vehicleType === 'bus' ? 'GO Bus' : 'GO Train'} ${vehicle.routeName ?? ''} to ${
      vehicle.destination ?? 'unknown destination'
    }${late ? `, ${delayMin} minutes late` : ''}`,
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
