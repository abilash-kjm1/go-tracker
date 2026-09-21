import 'server-only';

import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { zonedToInstant } from '../time';

/**
 * Parsers for the temporary GO Tracker upstream.
 *
 * Shapes here were derived by inspecting live responses, not from documentation.
 * A live trip element looks like:
 *
 *   <InServiceTripPublic Corridor="Lakeshore West" CorridorCode="LW"
 *     DelaySeconds="235" DelayMinute="3" DelayMemo="Operational issue"
 *     StartStation="Union Station" StartTime="12:17" EndStation="Aldershot GO"
 *     EndTime="13:26" Destination="Aldershot GO" TripNumber="1017"
 *     Latitude="43.41" Longitude="-79.72" Source="T" IsMoving="false"
 *     InStation="Bronte GO" InStationId="BO" Detail="On Time at Bronte GO"
 *     EquipmentCode="671" ModifiedDate="2026-09-20T13:08:56.357" ... />
 *
 * Everything is optional on purpose: the upstream drops attributes without
 * warning, and a missing field must degrade the row, not break the response.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  // Hardening: no entity expansion, no DOCTYPE processing.
  processEntities: true,
  htmlEntities: true,
  allowBooleanAttributes: true,
});

const str = z.string().optional();

const tripElementSchema = z
  .object({
    Corridor: str,
    CorridorCode: str,
    Service: str,
    ServiceCd: str,
    TripNumber: str,
    TripName: str,
    TripLabelDesc: str,
    StartStation: str,
    StartTime: str,
    EndStation: str,
    EndTime: str,
    Destination: str,
    Latitude: str,
    Longitude: str,
    DelaySeconds: str,
    DelayMinute: str,
    DelayDisplay: str,
    DelayMemo: str,
    Detail: str,
    /** "true" on runs that skip stops. */
    Express: str,
    Source: str,
    IsMoving: str,
    IsRunningTrip: str,
    IsEquipmentMove: str,
    ToHideMarker: str,
    InStation: str,
    InStationId: str,
    EquipmentCode: str,
    ModifiedDate: str,
  })
  .passthrough();

export type RawTripElement = z.infer<typeof tripElementSchema>;

const envelopeSchema = z
  .object({
    ErrCode: z.string().optional(),
    ErrMsg: z.string().optional(),
    Data: z.unknown().optional(),
  })
  .passthrough();

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Unwraps <ReturnValueOf...> and surfaces ErrCode as an error. */
function unwrapEnvelope(xml: string): { data: unknown } {
  if (!xml || !xml.trim().startsWith('<')) {
    throw new UpstreamError('Upstream returned a non-XML payload');
  }
  if (xml.includes('Invalid referral access')) {
    throw new UpstreamError(
      'Upstream rejected the request (referer check). Set GOTRACKER_REFERER.',
      'referer',
    );
  }

  const doc = parser.parse(xml) as Record<string, unknown>;
  const rootKey = Object.keys(doc).find((k) => k !== '?xml');
  if (!rootKey) throw new UpstreamError('Upstream returned an empty document');

  const root = envelopeSchema.safeParse(doc[rootKey]);
  if (!root.success) throw new UpstreamError('Unrecognized upstream envelope');

  const { ErrCode, ErrMsg, Data } = root.data;
  if (ErrCode && ErrCode !== '0') {
    throw new UpstreamError(ErrMsg || `Upstream error ${ErrCode}`, ErrCode);
  }
  return { data: Data };
}

export function parseTripLocations(xml: string): RawTripElement[] {
  const { data } = unwrapEnvelope(xml);
  if (!data || typeof data !== 'object') return [];
  const elements = asArray((data as Record<string, unknown>).InServiceTripPublic);
  const out: RawTripElement[] = [];
  for (const el of elements) {
    const parsed = tripElementSchema.safeParse(el);
    // Skip malformed rows rather than failing the whole feed.
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * StationStatusJSON returns a JSON document wrapped inside an XML envelope's
 * <Data> element. Observed payload: {"TripStatus":[],"S4Messages":[],"Messages":null}
 */
const stationStatusRowSchema = z
  .object({
    TripNumber: z.union([z.string(), z.number()]).optional(),
    TripNum: z.union([z.string(), z.number()]).optional(),
    ScheduledTime: str,
    ScheduledDepartureTime: str,
    EstimatedTime: str,
    ActualTime: str,
    DepartureTime: str,
    Delay: z.union([z.string(), z.number()]).optional(),
    DelaySeconds: z.union([z.string(), z.number()]).optional(),
    DelayMinute: z.union([z.string(), z.number()]).optional(),
    Destination: str,
    DestinationName: str,
    Origin: str,
    Track: str,
    Platform: str,
    Bay: str,
    Status: str,
    IsCancelled: z.union([z.string(), z.boolean()]).optional(),
    Cancelled: z.union([z.string(), z.boolean()]).optional(),
    Service: str,
    ServiceCd: str,
    CorridorCode: str,
    Corridor: str,
    Source: str,
    VehicleType: str,
    ModifiedDate: str,
  })
  .passthrough();

const stationStatusSchema = z
  .object({
    TripStatus: z.array(stationStatusRowSchema).nullable().optional(),
    S4Messages: z.array(z.unknown()).nullable().optional(),
    Messages: z.unknown().nullable().optional(),
  })
  .passthrough();

export type RawStationStatusRow = z.infer<typeof stationStatusRowSchema>;

export interface StationStatusPayload {
  rows: RawStationStatusRow[];
  messages: unknown[];
}

export function parseStationStatusJson(xml: string): StationStatusPayload {
  const { data } = unwrapEnvelope(xml);
  if (typeof data !== 'string' || !data.trim() || data.trim() === 'null') {
    return { rows: [], messages: [] };
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    throw new UpstreamError('Station status payload was not valid JSON');
  }
  const parsed = stationStatusSchema.safeParse(json);
  if (!parsed.success) return { rows: [], messages: [] };
  return {
    rows: parsed.data.TripStatus ?? [],
    messages: [...(parsed.data.S4Messages ?? [])].filter(Boolean),
  };
}

/** StationMessage returns a bare JSON string (often literally "null"). */
export function parseStationMessage(xml: string): string | null {
  const { data } = unwrapEnvelope(xml);
  if (typeof data !== 'string') return null;
  const trimmed = data.trim();
  if (!trimmed || trimmed === 'null') return null;
  return trimmed;
}

// ---- field helpers ------------------------------------------------------

export function toNumber(value: string | number | undefined | null): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function toBool(value: string | boolean | undefined | null): boolean | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const v = value.toLowerCase();
  if (v === 'true' || v === '1' || v === 'y' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'n' || v === 'no') return false;
  return undefined;
}

/**
 * Upstream `Source` observed as "T" for train. Bus rows have not been observed
 * in this feed, so anything unrecognized becomes "unknown" rather than being
 * guessed into a mode.
 */
export function sourceToVehicleType(source: string | undefined): 'train' | 'bus' | 'unknown' {
  const s = (source ?? '').trim().toUpperCase();
  if (s === 'T' || s === 'TRAIN' || s === 'RAIL') return 'train';
  if (s === 'B' || s === 'BUS' || s === 'C' || s === 'COACH') return 'bus';
  return 'unknown';
}

/** Upstream timestamps are Toronto-local and carry no offset. */
export function parseUpstreamTimestamp(value: string | undefined, fallback = new Date()): Date {
  if (!value) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value.trim());
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fallback : d;
  }
  const [, y, mo, d, h, mi, s, ms] = m;
  const seconds = Number(h) * 3600 + Number(mi) * 60 + Number(s);
  // Reuse the schedule zone conversion so DST is handled in one place.
  const instant = zonedToInstant(`${y}${mo}${d}`, seconds);
  return new Date(instant.getTime() + (ms ? Number(`0.${ms}`) * 1000 : 0));
}
