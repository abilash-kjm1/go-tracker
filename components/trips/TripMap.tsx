'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { basemapBackground, basemapStyleUrl } from '@/components/map/mapStyle';
import { useTheme } from '@/lib/client/theme';
import type { TripDetail } from '@/lib/transit/types';

/**
 * The trip's own map: the journey as a line, the stops as dots, and the
 * vehicle gliding along it. Small, always visible on the trip page, and it
 * keeps the train centred — no hunting for it among every other service.
 */
export function TripMap({ trip }: { trip: TripDetail }) {
  // Fitting the whole corridor makes a moving train look frozen — it covers
  // about a pixel a minute at that scale. Default to riding with it.
  const [view, setView] = useState<'follow' | 'route'>('follow');
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const tweenRef = useRef<number | null>(null);
  // The map's load handler and the vehicle poll race each other; these let
  // whichever wins frame the camera exactly once.
  const framedRef = useRef(false);
  const vehicleRef = useRef<[number, number] | null>(null);
  const viewRef = useRef<'follow' | 'route'>('follow');
  const { resolved } = useTheme();

  const points = trip.stops
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => [s.lon as number, s.lat as number] as [number, number]);

  const vehicle = trip.vehicle;
  const hasVehicle = Boolean(
    vehicle && Number.isFinite(vehicle.latitude) && Number.isFinite(vehicle.longitude),
  );
  vehicleRef.current = hasVehicle ? [vehicle!.longitude, vehicle!.latitude] : null;
  viewRef.current = view;

  // ---- create ------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current || points.length < 2) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyleUrl(resolved),
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('journey', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: points },
        },
      });
      map.addLayer({
        id: 'journey-line',
        type: 'line',
        source: 'journey',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': trip.routeColor ?? '#10b981',
          'line-width': 4,
          'line-opacity': 0.9,
        },
      });
      map.addSource('journey-stops', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: points.map((coordinates) => ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates },
          })),
        },
      });
      map.addLayer({
        id: 'journey-stops',
        type: 'circle',
        source: 'journey-stops',
        paint: {
          'circle-radius': 3.5,
          'circle-color': resolved === 'dark' ? '#0b0f17' : '#ffffff',
          'circle-stroke-color': trip.routeColor ?? '#10b981',
          'circle-stroke-width': 2,
        },
      });

      frameCamera(map, 0);
    });

    // Frames on the vehicle when following, otherwise on the whole journey.
    function frameCamera(target: MapLibreMap, duration: number) {
      const position = vehicleRef.current;
      if (viewRef.current === 'follow' && position) {
        target.easeTo({ center: position, zoom: 12.6, duration });
      } else {
        fitRoute(target, points, duration);
      }
      framedRef.current = true;
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Rebuilt only when the journey itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  // Switch between riding with the train and seeing the whole corridor.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (view === 'route') {
      fitRoute(map, points, 600);
    } else if (vehicle && hasVehicle) {
      map.easeTo({ center: [vehicle.longitude, vehicle.latitude], zoom: 12.6, duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Keep the vehicle framed without pinning it dead-centre: if the camera
  // recentred on every fix, the marker would sit still while the map slid
  // underneath — which reads as "the train isn't moving". Instead let it
  // travel across the frame and only pan once it approaches an edge.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || view !== 'follow' || !vehicle || !hasVehicle) return;

    const point = map.project([vehicle.longitude, vehicle.latitude]);
    const { width, height } = map.getCanvas().getBoundingClientRect();
    const insideComfortZone =
      point.x > width * 0.25 &&
      point.x < width * 0.75 &&
      point.y > height * 0.25 &&
      point.y < height * 0.75;

    if (!insideComfortZone) {
      map.easeTo({ center: [vehicle.longitude, vehicle.latitude], duration: 1400 });
    }
  }, [vehicle?.latitude, vehicle?.longitude, view, hasVehicle, vehicle]);

  // ---- vehicle -----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !vehicle || !hasVehicle) return;

    const target: [number, number] = [vehicle.longitude, vehicle.latitude];

    if (!markerRef.current) {
      // First fix arrived after the map loaded — frame it now.
      if (view === 'follow') {
        map.easeTo({ center: target, zoom: 12.6, duration: framedRef.current ? 700 : 0 });
        framedRef.current = true;
      }
      const el = document.createElement('div');
      el.style.cssText =
        'width:22px;height:22px;border-radius:999px;background:var(--accent);border:3px solid var(--bg-elevated);box-shadow:0 2px 8px rgb(0 0 0 /.35);animation:pulse-ring 2.4s ease-out infinite';
      el.setAttribute('aria-label', 'Live vehicle position');
      markerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(target)
        .addTo(map);
      return;
    }

    // Glide to the new position instead of teleporting between polls.
    const marker = markerRef.current;
    const from = marker.getLngLat();
    const start = performance.now();
    const duration = 1200;

    if (tweenRef.current) cancelAnimationFrame(tweenRef.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      marker.setLngLat([
        from.lng + (target[0] - from.lng) * eased,
        from.lat + (target[1] - from.lat) * eased,
      ]);
      if (t < 1) tweenRef.current = requestAnimationFrame(step);
    };
    tweenRef.current = requestAnimationFrame(step);

    return () => {
      if (tweenRef.current) cancelAnimationFrame(tweenRef.current);
    };
  }, [vehicle?.latitude, vehicle?.longitude, hasVehicle, vehicle]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.setStyle(basemapStyleUrl(resolved));
  }, [resolved]);

  if (points.length < 2) return null;

  return (
    <div
      className="relative h-[180px] w-full overflow-hidden rounded-2xl border hairline"
      style={{ background: basemapBackground(resolved) }}
    >
      <div ref={containerRef} className="size-full" />

      {hasVehicle ? (
        <button
          type="button"
          onClick={() => setView((v) => (v === 'follow' ? 'route' : 'follow'))}
          className="absolute top-2 right-2 rounded-full px-3 py-1.5 text-[11px] font-semibold surface"
        >
          {view === 'follow' ? 'Whole route' : 'Follow train'}
        </button>
      ) : null}
      {!hasVehicle ? (
        <p className="absolute inset-x-2 bottom-2 rounded-lg px-2 py-1.5 text-center text-[11px] surface">
          No live position for this trip — the route is shown from the schedule.
        </p>
      ) : null}
    </div>
  );
}

function fitRoute(map: MapLibreMap, points: Array<[number, number]>, duration: number) {
  if (points.length < 2) return;
  const bounds = points.reduce(
    (acc, p) => acc.extend(p),
    new maplibregl.LngLatBounds(points[0], points[0]),
  );
  map.fitBounds(bounds, { padding: 36, duration });
}
