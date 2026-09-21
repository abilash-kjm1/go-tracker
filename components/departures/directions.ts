import type { Departure } from '@/lib/transit/types';

/**
 * Splits a board into its travel directions, the way GO's own station screens
 * do ("Eastbound towards Union" / "Westbound towards Hamilton"). A single
 * merged list forces the rider to read every row to find the half that is
 * going their way.
 */

/**
 * Direction palettes. `a` and `b` are reserved for the two ends of a compass
 * axis — eastbound/northbound versus westbound/southbound — so a direction
 * keeps its colour however the board is sorted or refreshed. `c` and `d` cover
 * groups with no compass word (most bus stops, or a terminus split by line).
 */
export type DirectionTone = 'a' | 'b' | 'c' | 'd';

export type Compass = 'east' | 'west' | 'north' | 'south';

export interface DirectionGroup {
  key: string;
  /** Set when the label names a compass direction; drives the card arrow. */
  compass?: Compass;
  /** Heading shown above the column. */
  label: string;
  /** Two or three words, for the mobile direction chips. */
  shortLabel: string;
  tone: DirectionTone;
  departures: Departure[];
}

/** Resolved CSS custom properties for a direction's colour. */
export const directionColors = (tone: DirectionTone) => ({
  fg: `var(--dir-${tone})`,
  surface: `var(--dir-${tone}-surface)`,
  border: `var(--dir-${tone}-border)`,
});

/**
 * Prefers GO's own direction wording. Where no signage board exists (most bus
 * stops), it falls back to GTFS direction_id and names the group after the
 * destinations actually in it — never an invented compass direction.
 */
export function groupByDirection(departures: Departure[]): DirectionGroup[] {
  if (departures.length === 0) return [];

  // Bucket by direction_id, which every scheduled row carries. Signage text
  // only covers the next few trips, so bucketing on it would split one
  // direction into "has a label" and "doesn't" — the label is a heading, not
  // an identity.
  const buckets = new Map<string, Departure[]>();
  for (const departure of departures) {
    // direction_id is only meaningful within a mode: a train's "1" and a bus
    // route's "1" are unrelated, so a shared key would file a Niagara Falls
    // bus under "Eastbound towards Union".
    const key =
      departure.direction != null
        ? `${departure.vehicleType}-${departure.direction}`
        : (departure.directionLabel ?? 'dir-x');
    const bucket = buckets.get(key);
    if (bucket) bucket.push(departure);
    else buckets.set(key, [departure]);
  }

  // A terminus (Union) has only one travel direction, so splitting by it says
  // nothing. There the useful split is by line, which is what GO's own Union
  // board does.
  if (buckets.size === 1) {
    const byRoute = groupByRoute(departures);
    if (byRoute.length > 1) return byRoute;
  }

  const groups = [...buckets.entries()].map(([key, rows]) => {
    // Prefer GO's own wording from any row in this direction that has it.
    const signage = rows.find((r) => r.directionLabel)?.directionLabel;
    return {
      key,
      label: signage ? tidy(signage) : labelFromDestinations(rows),
      departures: rows,
    };
  });

  inferOppositeDirections(groups);

  // Soonest departure first, so the busier direction doesn't always lead.
  groups.sort((a, b) => firstTime(a.departures) - firstTime(b.departures));
  return withTones(groups);
}

const OPPOSITE: Record<string, string> = {
  east: 'West',
  west: 'East',
  north: 'South',
  south: 'North',
};

/**
 * GO's signage only labels the next few trips, so one direction of a line can
 * arrive with a compass word ("Northbound towards Allandale Waterfront") while
 * the other, further out, has none. A line runs in exactly two directions, so
 * when one of a mode's two groups is labelled the other is its opposite — and
 * gets the opposite word and colour rather than falling back to neutral.
 *
 * Only applied when there are exactly two groups for the mode and exactly one
 * is labelled; anything more ambiguous is left alone.
 */
function inferOppositeDirections(groups: Array<{ key: string; label: string; departures: Departure[] }>) {
  const byMode = new Map<string, typeof groups>();
  for (const group of groups) {
    const mode = group.departures[0]?.vehicleType ?? 'unknown';
    const list = byMode.get(mode);
    if (list) list.push(group);
    else byMode.set(mode, [group]);
  }

  for (const [mode, pair] of byMode) {
    if (mode !== 'train' || pair.length !== 2) continue;

    const compassOf = (label: string) => /\b(east|west|north|south)bound\b/i.exec(label)?.[1]?.toLowerCase();
    const [first, second] = pair;
    const a = compassOf(first.label);
    const b = compassOf(second.label);

    if (a && !b) second.label = describeOpposite(a, second.label);
    else if (b && !a) first.label = describeOpposite(b, first.label);
  }
}

function describeOpposite(knownCompass: string, label: string): string {
  const opposite = OPPOSITE[knownCompass];
  if (!opposite) return label;
  // "Towards Downsview Park GO" -> "Southbound towards Downsview Park GO"
  const rest = label.replace(/^towards\s+/i, '');
  return `${opposite}bound towards ${rest}`;
}

/**
 * Alternating palettes. Two directions is the normal case; a terminus grouped
 * by line simply cycles the same two so adjacent columns never match.
 */
function withTones(groups: Array<Omit<DirectionGroup, 'tone' | 'shortLabel'>>): DirectionGroup[] {
  let neutral = 0;
  return groups.map((group) => {
    // A compass word in the label decides the colour outright.
    const compass = compassTone(group.label);
    // Anything else alternates through the neutral pair, so neighbouring
    // columns never match and never borrow an eastbound/westbound colour.
    const tone: DirectionTone = compass ?? (neutral++ % 2 === 0 ? 'c' : 'd');
    const word = /\b(east|west|north|south)bound\b/i.exec(group.label)?.[1]?.toLowerCase();
    return {
      ...group,
      shortLabel: shorten(group.label),
      tone,
      compass: word as Compass | undefined,
    };
  });
}

/** East and north share a colour; west and south share the other. */
function compassTone(label: string): DirectionTone | null {
  const text = label.toLowerCase();
  if (/(east|north)bound/.test(text)) return 'a';
  if (/(west|south)bound/.test(text)) return 'b';
  return null;
}

/**
 * A chip has room for a place, not a sentence. "Towards Burlington Carpool &
 * Union Station" becomes "Burlington Carpool +1" — the leading destination,
 * with a count of the rest so nothing is silently hidden.
 */
function shorten(label: string): string {
  const withoutPrefix = label.replace(/^.*?towards\s+/i, '').trim() || label;
  const parts = withoutPrefix.split(/\s*(?:&|,)\s*/).filter(Boolean);
  const head = tidyPlace(parts[0] ?? withoutPrefix);
  const extra = parts.length - 1;
  const place = extra > 0 ? `${head} +${extra}` : head;

  // Keep the compass word: the chip is coloured by it, and a colour alone
  // should never be the only thing saying which way a train is going.
  const compass = /\b(east|west|north|south)bound\b/i.exec(label)?.[1];
  return compass ? `${compass.charAt(0).toUpperCase()}${compass.slice(1).toLowerCase()} · ${place}` : place;
}

/** GO's own suffixes add no meaning on a chip. */
function tidyPlace(name: string): string {
  return (
    name
      .replace(/\s+\+\d+\s*more$/i, '')
      .replace(/\s+(go\s+bus|bus\s+terminal|go\s+station|go)$/i, '')
      .trim() || name
  );
}

function groupByRoute(departures: Departure[]): DirectionGroup[] {
  const buckets = new Map<string, Departure[]>();
  for (const departure of departures) {
    const key = departure.routeId ?? departure.routeCode ?? departure.routeName ?? 'other';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(departure);
    else buckets.set(key, [departure]);
  }

  const groups = [...buckets.entries()]
    .map(([key, rows]) => ({
      key,
      label: rows[0].routeName ?? rows[0].routeCode ?? 'Other departures',
      departures: rows,
    }))
    .sort((a, b) => firstTime(a.departures) - firstTime(b.departures));
  return withTones(groups);
}

function firstTime(rows: Departure[]): number {
  return Math.min(...rows.map((r) => new Date(r.estimatedTime ?? r.scheduledTime).getTime()));
}

/** "Eastbound towards Union" reads better than "EASTBOUND TOWARDS UNION". */
function tidy(label: string): string {
  const trimmed = label.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Names a direction after the terminus its trips actually reach. One
 * destination gives "Towards Aldershot GO"; several list the two most common
 * and count the rest, so nothing is hidden or fabricated.
 */
function labelFromDestinations(rows: Departure[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const dest = row.destination?.trim();
    if (dest) counts.set(dest, (counts.get(dest) ?? 0) + 1);
  }
  if (counts.size === 0) return 'Other departures';

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  if (ranked.length === 1) return `Towards ${ranked[0]}`;
  if (ranked.length === 2) return `Towards ${ranked[0]} & ${ranked[1]}`;
  return `Towards ${ranked[0]}, ${ranked[1]} +${ranked.length - 2} more`;
}
