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
import { formatClockParts } from '@/lib/transit/time';
import type {
  LiveVehicle,
  TransitRoute,
  TransitStop,
  TripDetail,
  VehicleType,
} from '@/lib/transit/types';

type ModeFilter = 'all' | VehicleType;

interface MarkerEntry {
  marker: Marker;
  el: HTMLElement;
  from: [number, number];
  to: [number, number];
  startedAt: number;
  /** How long to take reaching `to`: the gap between fixes, so motion never pauses. */
  durationMs: number;
  updatedAt: number;
  vehicle: LiveVehicle;
}

const MIN_TWEEN_MS = 4_000;
const MAX_TWEEN_MS = 25_000;
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The live map. Vehicles are DOM markers tweened between polls so they glide
 * instead of jumping every 15 seconds; stations are a GeoJSON source
 * so the map stays fast when every stop is shown.
 */
export function LiveMap({ stops, routes }: { stops: TransitStop[]; routes: TransitRoute[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, MarkerEntry>());
  const routeColorRef = useRef(new Map<string, string>());
  const frameRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<ModeFilter>('all');
  const [routeId, setRouteId] = useState<string>('all');
  const [selected, setSelected] = useState<LiveVehicle | null>(null);
  const [showStations, setShowStations] = useState(true);
  const { resolved } = useTheme();
  const routeColors = useMemo(
    () => new Map(routes.filter((r) => r.color).map((r) => [r.id, r.color as string])),
    [routes],
  );
  routeColorRef.current = routeColors;

  // ?trip=<gtfs trip id> arrives from a trip page's "Follow on the live map".
  const params = useSearchParams();
  const followTripId = params.get('trip');
  const [following, setFollowing] = useState<string | null>(followTripId);
  const hasCentredRef = useRef(false);
  // While locked, the camera rides with the followed train every frame.
  const [locked, setLocked] = useState(true);
  const lockedRef = useRef(true);
  lockedRef.current = locked;
  const followingRef = useRef<string | null>(following);
  followingRef.current = following;
  const settleUntilRef = useRef(0);

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

  // The trip being watched (followed, or tapped): its route and stops are drawn.
  const focusTripId = following ?? selected?.tripId ?? null;
  const { data: focusTrip } = useTransit<TripDetail>(
    focusTripId ? `/api/transit/trips/${encodeURIComponent(focusTripId)}` : null,
    { intervalMs: 20_000, enabled: Boolean(focusTripId) },
  );
  const focusRef = useRef<TripDetail | null>(null);
  focusRef.current = focusTrip && focusTrip.id === focusTripId ? focusTrip : null;

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
          label: s.name.replace(/\s+GO(\s+Bus)?$/i, ''),
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
    });

    // Train stations at every zoom; bus stops only once close enough to read.
    const dot = (id: string, isStation: number, minzoom: number) =>
      map.addLayer({
        id,
        type: 'circle',
        source: 'stations',
        minzoom,
        filter: ['==', ['get', 'isStation'], isStation],
        paint: {
          'circle-radius': isStation ? 5.5 : 3.5,
          'circle-color': isStation ? '#10b981' : resolved === 'dark' ? '#7f8b9e' : '#5a6579',
          'circle-stroke-color': resolved === 'dark' ? '#0b0f17' : '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });
    dot('station-points', 1, 0);
    dot('stop-points', 0, 12);

    // Names: stations from the regional view down, every stop once zoomed in.
    map.addLayer({
      id: 'station-labels',
      type: 'symbol',
      source: 'stations',
      minzoom: 9.2,
      filter: ['==', ['get', 'isStation'], 1],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['noto_sans_bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 13, 12.5],
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-optional': true,
      },
      paint: {
        'text-color': resolved === 'dark' ? '#eceff4' : '#1f2735',
        'text-halo-color': resolved === 'dark' ? '#0b0f17' : '#ffffff',
        'text-halo-width': 1.8,
      },
    });
    map.addLayer({
      id: 'stop-labels',
      type: 'symbol',
      source: 'stations',
      minzoom: 13.2,
      filter: ['==', ['get', 'isStation'], 0],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['noto_sans_regular'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'text-optional': true,
      },
      paint: {
        'text-color': resolved === 'dark' ? '#b7c0cf' : '#3a4557',
        'text-halo-color': resolved === 'dark' ? '#0b0f17' : '#ffffff',
        'text-halo-width': 1.5,
      },
    });

    for (const layer of ['station-points', 'stop-points']) {
      map.on('click', layer, (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === 'string') window.location.assign(`/stations/${encodeURIComponent(id)}`);
      });
    }
    for (const layer of ['station-points', 'stop-points']) {
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
    for (const id of ['station-points', 'stop-points', 'station-labels', 'stop-labels']) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', showStations ? 'visible' : 'none');
      }
    }
  }, [showStations, ready]);

  // ---- watched trip: its route line and named stops ----------------------

  const syncFocus = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    const trip = focusRef.current;
    const located = (trip?.stops ?? []).filter(
      (st) => Number.isFinite(st.lat) && Number.isFinite(st.lon),
    );
    const next = located.findIndex((st) => st.status !== 'departed');
    const color = trip?.routeColor ?? '#10b981';
    const line = {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: located.map((st) => [st.lon as number, st.lat as number]),
      },
    };
    const stopData = {
      type: 'FeatureCollection' as const,
      features: located.map((st, i) => {
        const clock = formatClockParts(
          st.estimatedDeparture ?? st.scheduledDeparture ?? st.scheduledArrival,
        );
        return {
          type: 'Feature' as const,
          properties: {
            name: st.stopName.replace(/\s+GO(\s+Bus)?$/i, ''),
            time: clock.time ? `${clock.time} ${clock.suffix}`.trim() : '',
            state: st.status === 'departed' ? 'past' : i === next ? 'next' : 'ahead',
          },
          geometry: { type: 'Point' as const, coordinates: [st.lon as number, st.lat as number] },
        };
      }),
    };

    if (!map.getSource('focus-line')) {
      map.addSource('focus-line', { type: 'geojson', data: line });
      map.addSource('focus-stops', { type: 'geojson', data: stopData });
      map.addLayer({
        id: 'focus-line-casing',
        type: 'line',
        source: 'focus-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': resolved === 'dark' ? '#0b0f17' : '#ffffff',
          'line-width': 9,
          'line-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'focus-line',
        type: 'line',
        source: 'focus-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': 5 },
      });
      map.addLayer({
        id: 'focus-stops',
        type: 'circle',
        source: 'focus-stops',
        paint: {
          'circle-radius': ['match', ['get', 'state'], 'next', 8, 5],
          'circle-color': [
            'match',
            ['get', 'state'],
            'past',
            '#9aa4b5',
            'next',
            '#f59e0b',
            resolved === 'dark' ? '#0b0f17' : '#ffffff',
          ],
          'circle-stroke-color': [
            'match',
            ['get', 'state'],
            'past',
            '#9aa4b5',
            'next',
            '#ffffff',
            color,
          ],
          'circle-stroke-width': ['match', ['get', 'state'], 'next', 3, 2.5],
        },
      });
      map.addLayer({
        id: 'focus-stop-labels',
        type: 'symbol',
        source: 'focus-stops',
        layout: {
          'text-field': ['format', ['get', 'name'], {}, '\n', {}, ['get', 'time'], { 'font-scale': 0.85 }],
          'text-font': ['noto_sans_bold'],
          'text-size': 12.5,
          'text-anchor': 'top',
          'text-offset': [0, 1],
          'text-optional': true,
        },
        paint: {
          'text-color': resolved === 'dark' ? '#ffffff' : '#111827',
          'text-halo-color': resolved === 'dark' ? '#0b0f17' : '#ffffff',
          'text-halo-width': 2,
        },
      });
    }

    (map.getSource('focus-line') as GeoJSONSource).setData(line);
    (map.getSource('focus-stops') as GeoJSONSource).setData(stopData);
    map.setPaintProperty('focus-line', 'line-color', color);
  }, [resolved]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    syncFocus();
    map.on('styledata', syncFocus);
    return () => {
      map.off('styledata', syncFocus);
    };
  }, [ready, syncFocus, focusTrip, focusTripId]);

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
        const moved = existing.to[0] !== target[0] || existing.to[1] !== target[1];
        if (moved) {
          const now = performance.now();
          const current = existing.marker.getLngLat();
          const heading = bearing([current.lng, current.lat], target);
          existing.from = [current.lng, current.lat];
          existing.to = target;
          // Spread the move over the time since the last fix: a short ease-out
          // makes a train hop and then look parked until the next poll.
          existing.durationMs = Math.min(
            MAX_TWEEN_MS,
            Math.max(MIN_TWEEN_MS, now - existing.updatedAt),
          );
          existing.startedAt = now;
          existing.updatedAt = now;
          existing.vehicle = vehicle;
          updateMarkerEl(existing.el, vehicle, heading, routeColorRef.current.get(vehicle.routeId ?? ''));
          // Without the tween loop the marker would otherwise never move at all.
          if (prefersReducedMotion()) existing.marker.setLngLat(target);
        } else {
          existing.vehicle = vehicle;
          updateMarkerEl(existing.el, vehicle, null, routeColorRef.current.get(vehicle.routeId ?? ''));
        }
      } else {
        const el = createMarkerEl(
          vehicle,
          map.getZoom() < 10,
          routeColorRef.current.get(vehicle.routeId ?? ''),
        );
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
          durationMs: 15_000,
          updatedAt: performance.now(),
          vehicle,
        });
      }
    }

    // The followed train is icon-only: its details are on the card, and a big
    // label would sit on top of the stop names it is passing.
    for (const entry of markersRef.current.values()) {
      entry.el.dataset.followed =
        following && entry.vehicle.tripId === following ? 'true' : 'false';
    }

    for (const [id, entry] of markersRef.current) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [visible, ready, following]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !followed) return;
    if (!Number.isFinite(followed.latitude) || !Number.isFinite(followed.longitude)) return;

    if (!hasCentredRef.current) {
      // First lock-on: fly in close enough to read the stop names around it.
      settleUntilRef.current = performance.now() + 1100;
      map.easeTo({ center: [followed.longitude, followed.latitude], zoom: 12.8, duration: 900 });
      hasCentredRef.current = true;
      setLocked(true);
      // Deliberately not opening the detail sheet: it would cover the vehicle
      // we just flew to. The follow card names it; tapping the marker opens it.
    }
  }, [followed, ready]);

  // Dragging the map hands control back to the rider.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const release = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) setLocked(false);
    };
    map.on('dragstart', release);
    return () => {
      map.off('dragstart', release);
    };
  }, [ready]);

  useEffect(() => {
    if (!following) hasCentredRef.current = false;
  }, [following]);

  // Glide markers continuously toward their latest fix. Linear over the gap to
  // the next poll, so a train keeps moving instead of hopping and then waiting.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const step = () => {
      const now = performance.now();
      const map = mapRef.current;
      for (const entry of markersRef.current.values()) {
        const t = Math.min(1, (now - entry.startedAt) / entry.durationMs);
        if (t < 1) {
          entry.marker.setLngLat([
            entry.from[0] + (entry.to[0] - entry.from[0]) * t,
            entry.from[1] + (entry.to[1] - entry.from[1]) * t,
          ]);
        }
        // Ride along: the map slides past the named stops as the train travels.
        if (
          map &&
          lockedRef.current &&
          followingRef.current &&
          entry.vehicle.tripId === followingRef.current &&
          now > settleUntilRef.current
        ) {
          map.jumpTo({ center: entry.marker.getLngLat() });
        }
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
          <div className="pointer-events-auto w-full max-w-sm rounded-2xl p-3 text-[13px] surface">
            {followed ? (
              <FollowCard
                vehicle={followed}
                trip={focusTrip && focusTrip.id === following ? focusTrip : null}
                locked={locked}
                onRecentre={() => {
                  const map = mapRef.current;
                  if (map) map.easeTo({ center: [followed.longitude, followed.latitude], zoom: Math.max(map.getZoom(), 12.5), duration: 600 });
                  settleUntilRef.current = performance.now() + 700;
                  setLocked(true);
                }}
                onStop={() => setFollowing(null)}
              />
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">That trip is not reporting a position right now</span>
                <button
                  type="button"
                  onClick={() => setFollowing(null)}
                  aria-label="Stop following"
                  className="grid size-7 place-items-center rounded-full bg-[var(--bg-sunken)] text-[var(--fg-muted)]"
                >
                  ✕
                </button>
              </div>
            )}
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

function FollowCard({
  vehicle,
  trip,
  locked,
  onRecentre,
  onStop,
}: {
  vehicle: LiveVehicle;
  trip: TripDetail | null;
  locked: boolean;
  onRecentre: () => void;
  onStop: () => void;
}) {
  const upcoming = (trip?.stops ?? []).filter((st) => st.status !== 'departed');
  const next = upcoming[0];
  const nextClock = next
    ? formatClockParts(next.estimatedDeparture ?? next.scheduledDeparture ?? next.scheduledArrival)
    : null;
  const delayMin = vehicle.delaySeconds != null ? Math.round(vehicle.delaySeconds / 60) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            <span className="live-dot size-2 shrink-0 rounded-full bg-signal-500" aria-hidden />
            <span className="truncate">
              {vehicle.routeName ?? 'Service'}
              {vehicle.tripNumber ? ` ${vehicle.tripNumber}` : ''}
              {vehicle.destination ? ` to ${vehicle.destination.replace(/\s+GO$/i, '')}` : ''}
            </span>
          </p>
          <p className="mt-0.5 text-muted">
            {delayMin >= 1 ? `${delayMin} min late` : 'On time'}
            {vehicle.isMoving === false ? ' · stopped' : ' · moving'}
          </p>
        </div>
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop following"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--bg-sunken)] text-[var(--fg-muted)]"
        >
          ✕
        </button>
      </div>

      {next ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg-sunken)] px-3 py-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-faint uppercase">Next stop</p>
            <p className="truncate font-semibold">{next.stopName.replace(/\s+GO(\s+Bus)?$/i, '')}</p>
          </div>
          <div className="shrink-0 text-right">
            {nextClock?.time ? (
              <p className="tabular font-semibold">
                {nextClock.time} {nextClock.suffix}
              </p>
            ) : null}
            <p className="text-[11px] text-muted">
              {upcoming.length} stop{upcoming.length === 1 ? '' : 's'} left
            </p>
          </div>
        </div>
      ) : null}

      {!locked ? (
        <button
          type="button"
          onClick={onRecentre}
          className="w-full rounded-full bg-[var(--accent)] px-3 py-2 text-[13px] font-semibold text-[var(--accent-fg)]"
        >
          Re-centre on this train
        </button>
      ) : null}
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

function createMarkerEl(vehicle: LiveVehicle, compact: boolean, lineColor?: string): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'gt-marker';
  el.dataset.compact = compact ? 'true' : 'false';
  el.style.cssText =
    'display:flex;align-items:center;gap:6px;padding:3px 8px 3px 4px;border-radius:999px;border:1px solid var(--border-strong);background:var(--bg-elevated);box-shadow:var(--shadow-card);font:600 11px/1 var(--font-sans);color:var(--fg);cursor:pointer;transition:transform .15s ease;white-space:nowrap';
  updateMarkerEl(el, vehicle, undefined, lineColor);
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

function updateMarkerEl(
  el: HTMLElement,
  vehicle: LiveVehicle,
  heading?: number | null,
  lineColor?: string,
) {
  const delayMin = vehicle.delaySeconds != null ? Math.round(vehicle.delaySeconds / 60) : 0;
  const late = delayMin >= 1;
  const icon = vehicle.vehicleType === 'bus' ? BUS_PATH : TRAIN_PATH;
  // Each line keeps its own colour so trains are told apart at a glance; lateness
  // is a separate amber tag, never a change of the line colour.
  const tint = lineColor ?? 'var(--color-signal-500)';

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
      )}</span>
      ${late ? `<span style="font-weight:700;color:var(--color-warn-500)">+${delayMin} min late</span>` : ''}
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
