import 'server-only';

import { z } from 'zod';
import { zonedToInstant } from '../time';

/**
 * Parsers for the GO Tracker *mobile proxy* API — the modern JSON service that
 * powers gotracker.ca today:
 *
 *   https://www.gotracker.ca/gotracker/mobile/proxy/web/...
 *
 * This is a different service from the legacy GODataAPIProxy.svc endpoints.
 * It needs no key and no Referer, and crucially it is the one that carries
 * platform ("track") for trains AND bus bays, plus live expected times.
 *
 * Endpoints in use (discovered from the live app, then verified by hand):
 *   Messages/Signage/Rail/{corridorCode}/{stationCode}   ALL only works for UN
 *   Messages/Signage/Bus/{terminalCode}
 *   Info/Places/BusTerminal
 *
 * Every field is optional: this is an undocumented API and a missing field
 * must degrade a row, not break the board.
 */

const localized = z.array(z.object({ language: z.string().optional(), text: z.string().optional() }));

const railTripSchema = z
  .object({
    /** Public trip number, despite the name. */
    tripName: z.string().optional(),
    destination: z.string().optional(),
    /** Platform. GO's own UI labels this column "Pltfrm". */
    track: z.string().optional(),
    scheduled: z.string().optional(),
    actual: z.string().optional(),
    isExpress: z.boolean().optional(),
    coachCount: z.number().optional(),
    scheduledCoachCount: z.number().optional(),
    remarks: localized.optional(),
    messages: z.array(z.unknown()).optional(),
    stopsList: z
      .array(z.object({ stopCode: z.string().optional(), stopName: z.string().optional() }))
      .optional(),
  })
  .passthrough();

const railSignageSchema = z
  .object({
    directions: z
      .array(
        z
          .object({
            direction: z.string().optional(),
            directionText: localized.optional(),
            tripMessages: z.array(railTripSchema).nullable().optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
    messages: z.array(z.unknown()).nullable().optional(),
    errCode: z.union([z.number(), z.string()]).optional(),
    errMsg: z.string().optional(),
  })
  .passthrough();

const busTripSchema = z
  .object({
    tripNumber: z.string().optional(),
    /** Destination, despite the name. */
    tripName: z.string().optional(),
    lineCode: z.string().optional(),
    /** GTFS stop id of the bay this row departs from. */
    stopCode: z.string().optional(),
    schTrack: z.string().nullable().optional(),
    actTrack: z.string().nullable().optional(),
    schDepartureTimestamp: z.string().nullable().optional(),
    expDepartureTimestamp: z.string().nullable().optional(),
    schArrivalTimestamp: z.string().nullable().optional(),
    delaySecond: z.number().nullable().optional(),
    isCancelled: z.boolean().optional(),
    isTripCancelled: z.boolean().optional(),
    isExpress: z.boolean().optional(),
    isDone: z.boolean().optional(),
  })
  .passthrough();

const busSignageSchema = z
  .object({
    stopName: z.string().optional(),
    commitmentTrips: z.array(busTripSchema).nullable().optional(),
  })
  .passthrough();

const busTerminalSchema = z
  .object({
    places: z
      .array(
        z
          .object({
            id: z.number().optional(),
            code: z.string(),
            description: z.string().optional(),
            latitude: z.number().optional(),
            longitude: z.number().optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
  })
  .passthrough();

/** What a board row contributes on top of the schedule. */
export interface LiveBoardRow {
  tripNumber: string;
  /** Already rider-facing: "Platform 4". */
  platform?: string;
  scheduledTime?: string;
  expectedTime?: string;
  delaySeconds?: number;
  cancelled: boolean;
  destination?: string;
  isExpress?: boolean;
  /** Train length, where reported. */
  coachCount?: number;
  scheduledCoachCount?: number;
  /** Operator remarks, e.g. "Welland Canal bridge issue". */
  remarks: string[];
  directionText?: string;
  /**
   * Board-supplied status where there is no platform yet. Union publishes
   * "Wait / Attendez" until it assigns one, which is information, not a gap.
   */
  note?: string;
}

export interface BusTerminalPlace {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

/** Timestamps arrive either bare (Toronto local) or with an offset. */
function toIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('0001-01-01')) return undefined;

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const seconds = Number(h) * 3600 + Number(mi) * 60 + Number(s ?? 0);
  return zonedToInstant(`${y}${mo}${d}`, seconds).toISOString();
}

/** Riders read "Platform" — GO's own board labels the bus column that way too. */
function toPlatform(value: string | null | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw || raw === '-' || raw === '0') return undefined;
  if (/^\d+[A-Za-z]?$/.test(raw)) return `Platform ${raw}`;
  // Union publishes shared assignments like "7 & 8" for long trains.
  if (/^\d+[A-Za-z]?(\s*(?:&|and|\/|,)\s*\d+[A-Za-z]?)+$/i.test(raw)) return `Platforms ${raw}`;
  return raw.replace(/^track\b/i, 'Platform');
}

function englishText(entries: z.infer<typeof localized> | undefined): string[] {
  if (!entries) return [];
  return entries
    .filter((e) => (e.language ?? 'English').toLowerCase().startsWith('en'))
    .map((e) => e.text?.trim())
    .filter((t): t is string => Boolean(t));
}

export function parseRailSignage(payload: unknown): LiveBoardRow[] {
  const parsed = railSignageSchema.safeParse(payload);
  if (!parsed.success) return [];

  const out: LiveBoardRow[] = [];
  for (const direction of parsed.data.directions ?? []) {
    const directionText = englishText(direction.directionText)[0];
    for (const trip of direction.tripMessages ?? []) {
      const tripNumber = trip.tripName?.trim();
      if (!tripNumber) continue;

      const scheduledTime = toIso(trip.scheduled);
      const expectedTime = toIso(trip.actual);
      const delaySeconds =
        scheduledTime && expectedTime
          ? Math.round((new Date(expectedTime).getTime() - new Date(scheduledTime).getTime()) / 1000)
          : undefined;

      out.push({
        tripNumber,
        platform: toPlatform(trip.track),
        scheduledTime,
        expectedTime,
        delaySeconds,
        // Rail signage has no cancellation flag; remarks carry the wording.
        cancelled: englishText(trip.remarks).some((r) => /cancel/i.test(r)),
        destination: trip.destination?.trim() || undefined,
        isExpress: trip.isExpress,
        coachCount: trip.coachCount,
        scheduledCoachCount: trip.scheduledCoachCount,
        remarks: englishText(trip.remarks),
        directionText,
      });
    }
  }
  return out;
}

export function parseBusSignage(payload: unknown): LiveBoardRow[] {
  const parsed = busSignageSchema.safeParse(payload);
  if (!parsed.success) return [];

  const out: LiveBoardRow[] = [];
  for (const trip of parsed.data.commitmentTrips ?? []) {
    const tripNumber = trip.tripNumber?.trim();
    if (!tripNumber) continue;

    out.push({
      tripNumber,
      platform: toPlatform(trip.actTrack ?? trip.schTrack),
      scheduledTime: toIso(trip.schDepartureTimestamp),
      expectedTime: toIso(trip.expDepartureTimestamp),
      delaySeconds: trip.delaySecond ?? undefined,
      cancelled: trip.isCancelled === true || trip.isTripCancelled === true,
      destination: trip.tripName?.trim() || undefined,
      isExpress: trip.isExpress,
      remarks: [],
    });
  }
  return out;
}

/** Which GTFS stop each bus signage row belongs to, so bays land on the right stop. */
export function busRowStopCodes(payload: unknown): Map<string, string> {
  const parsed = busSignageSchema.safeParse(payload);
  const out = new Map<string, string>();
  if (!parsed.success) return out;
  for (const trip of parsed.data.commitmentTrips ?? []) {
    const tripNumber = trip.tripNumber?.trim();
    const stopCode = trip.stopCode?.trim();
    if (tripNumber && stopCode) out.set(tripNumber, stopCode);
  }
  return out;
}

const unionTripSchema = z
  .object({
    number: z.string().optional(),
    platform: z.string().nullable().optional(),
    service: z.string().optional(),
    /** "T" or "B". */
    serviceType: z.string().optional(),
    time: z.string().optional(),
    info: z.string().optional(),
    isExpress: z.boolean().optional(),
    coachCount: z.number().optional(),
    scheduledCoachCount: z.number().optional(),
    stops: z.array(z.object({ name: z.string().optional() })).nullable().optional(),
  })
  .passthrough();

const unionDeparturesSchema = z
  .object({
    status: z.string().optional(),
    date: z.string().optional(),
    trips: z.array(unionTripSchema).nullable().optional(),
  })
  .passthrough();

/**
 * Union's own board. Unlike every other station it publishes no corridor
 * signage; platform stays "-" until GO assigns it, with info "Wait / Attendez".
 */
export function parseUnionDepartures(payload: unknown): LiveBoardRow[] {
  const parsed = unionDeparturesSchema.safeParse(payload);
  if (!parsed.success) return [];

  const out: LiveBoardRow[] = [];
  for (const trip of parsed.data.trips ?? []) {
    const tripNumber = trip.number?.trim();
    if (!tripNumber) continue;

    const platform = toPlatform(trip.platform);
    // "Wait / Attendez" is the bilingual string GO's own board shows.
    const rawInfo = trip.info?.trim();
    const note =
      !platform && rawInfo
        ? /wait/i.test(rawInfo)
          ? 'Platform posted closer to departure'
          : rawInfo
        : undefined;

    out.push({
      tripNumber,
      platform,
      scheduledTime: toIso(trip.time),
      cancelled: /cancel/i.test(rawInfo ?? ''),
      isExpress: trip.isExpress,
      coachCount: trip.coachCount,
      scheduledCoachCount: trip.scheduledCoachCount,
      remarks: [],
      note,
    });
  }
  return out;
}

export function parseBusTerminals(payload: unknown): BusTerminalPlace[] {
  const parsed = busTerminalSchema.safeParse(payload);
  if (!parsed.success) return [];
  return (parsed.data.places ?? [])
    .map((p) => ({
      code: p.code,
      name: (p.description ?? p.code).replace(/\s*\(\d+\)\s*$/, '').trim(),
      lat: p.latitude ?? 0,
      lon: p.longitude ?? 0,
    }))
    // Some terminals publish 0,0 — unusable for matching.
    .filter((p) => p.code && p.lat !== 0 && p.lon !== 0);
}
