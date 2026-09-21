# GO Tracker

An independent GO Transit tracker — live GO Train and GO Bus departures, delays, trip
tracking and vehicle positions. Next.js 15 + TypeScript + Tailwind v4 + MapLibre, deployable
to Vercel.

Not operated by, endorsed by, or affiliated with Metrolinx or GO Transit.

---

## What the upstream data actually provides

Every field below was verified against live responses, not documentation. Read this before
changing a parser — several of the assumptions in the original brief do not hold.

### There are TWO GO Tracker APIs, and the brief points at the older one

| | Legacy SOAP-ish proxy | **Mobile proxy (current)** |
| --- | --- | --- |
| Base | `/GOTracker/web/GODataAPIProxy.svc` | `/gotracker/mobile/proxy/web` |
| Format | XML envelopes (JSON stuffed in `<Data>`) | Clean JSON |
| Auth | Rejects requests without a `Referer` | None needed |
| Station boards | **Broken** — returns `Error retrieving Station Status from S4!` | Working |
| Platform numbers | None | **Yes, trains and buses** |
| Live positions | Yes (trains only) | — |

`gotracker.ca` itself is very much alive; it runs on the mobile proxy. The legacy `.svc`
service is still up but its station-status backend is dead, which is why the platform field
looked impossible until the live site was inspected directly.

We use **both**: the legacy service for live train positions, the mobile proxy for boards.

### Mobile proxy endpoints in use

```
Messages/Signage/Rail/{corridorCode}/{stationCode}   platform + expected time per train
Messages/Departures/UN                              Union's own board (see below)
Messages/Signage/Bus/{terminalCode}                 platform + delay per bus, by bay
Info/Places/BusTerminal                             the 16 terminals with live bay data
```

Discovered endpoints not yet used: `Info/TripPatterns/{Train,Bus}`, `Schedule/Today/All`,
`Schedule/Today/Trip/{n}`, `Messages/Signage/Bus/TripDetail/{n}`, `Messages/Departures/USBT/{n}`,
plus a SignalR hub broadcasting `RailOccupancy.Coach.Update` (live seat occupancy).

### Five things worth knowing

1. **Rail signage is per corridor.** `Messages/Signage/Rail/LW/BU` works; `ALL/BU` returns
   zero trips. Corridor codes come from the GTFS route id suffix (`…-LW`, `…-GT`).

2. **Union is special.** It publishes no corridor signage at all — use `Messages/Departures/UN`.
   Its `platform` field is literally `"-"` with `info: "Wait / Attendez"` until GO assigns one,
   which the UI surfaces as *"Platform posted closer to departure"* rather than a blank. Long
   trains get shared assignments like `"7 & 8"`.

3. **Buses have live platforms and delays**, via terminal signage — `schTrack`/`actTrack`,
   `delaySecond`, `expDepartureTimestamp`, `isCancelled`. Each row carries the GTFS `stopCode`
   of its bay, which is how a bay lands on the right stop. Only the ~16 terminals in
   `Info/Places/BusTerminal` publish this; every other bus stop stays schedule-only. GTFS bus
   stops are matched to a terminal by position (≤500 m).

4. **GO labels the column "Pltfrm" for buses too**, so both modes say "Platform N" here — that
   matches the wording riders see on GO's own screens.

5. **`TripLocation` (legacy) returns trains only.** Every observed row carries `Source="T"`;
   only `ALL` works as a service code. The parser maps `T`→train and `B`/`C`→bus so bus rows
   would flow through if they ever appear. Live *bus* data reaches the app through the bus
   signage board instead.

### Route variants

GO runs lettered variants of a bus route — 12, 12B and 12D all sit under route 12 but serve
different stops, and the letter is what is written on the front of the bus. GTFS carries this
in `trips.route_variant` (and repeated in `trip_headsign`, "12B - Burlington GO"), so the
snapshot keeps it per trip and the UI badges the variant while filters and grouping still work
off the parent route. Searching "12B" finds route 12.

The headsign is also the rider-facing destination — "Burlington GO", where the terminus stop
is internally named "Burlington GO Bus" — so boards and trip pages prefer it.

### Response quirks

- Mobile proxy responses are served with a **UTF-8 BOM**, which `JSON.parse` rejects — strip it.
- In rail signage, `tripName` is the **trip number** and `destination` is the destination.
  In bus signage, `tripNumber` is the trip number and `tripName` is the **destination**.
- Bus timestamps carry an offset; rail timestamps are bare Toronto local time.

### How departures work given all that

Departure boards are the **GTFS schedule with the live board merged on by trip number**.
GTFS trip ids look like `20260920-LW-1639`, where the tail is the public trip number both
upstreams use — that join is what lets a platform, expected time and delay land on a
scheduled row.

The schedule is what gives full coverage: 38 bus routes and 817 bus-only stops that no
real-time feed mentions still get a board, marked `SCHEDULED`. Where a signage board exists,
rows gain a platform and turn `LIVE`.

Rows are never dressed up: a row is `realtime` only when a live vehicle or station-status
row backs it, and the API envelope carries `freshness: live | stale | scheduled | unavailable`.

---

## Architecture

```
Frontend (components/, app/)
      ↓  our API only — never the upstream directly
Backend route handlers (app/api/transit/*)
      ↓
TransitDataProvider  (lib/transit/provider.ts)
      ├── GoTrackerTemporaryProvider   — live today
      └── MetrolinxOfficialProvider    — wired, unverified (no key yet)
      ↓
TTL cache + request coalescing (lib/transit/cache.ts)
      ↓
┌─ legacy .svc      → live train positions
├─ mobile proxy     → platform boards (rail + bus)   lib/transit/sources/goTrackerBoards.ts
├─ Metrolinx API    → platform override, when a key is set (optional)
└─ GTFS snapshots   → stops, routes, schedule (data/gtfs/)
```

Swapping providers is two environment variables. No frontend change, because components only
ever see the normalized models in `lib/transit/types.ts`.

### Caching

One upstream request serves everyone. `cached()` coalesces concurrent calls on the same key,
serves within the TTL from memory, and on failure keeps serving the last good value marked
stale rather than blanking the UI. 100 people watching one station produce one request.

---

## Setup

```bash
npm install
cp .env.example .env.local
npm run gtfs:build          # downloads the Metrolinx GTFS feed (~22 MB) and builds snapshots
npm run dev
```

`npm run gtfs:build` writes `data/gtfs/` (git-ignored, ~7.5 MB for 10 days):

- `stops.json` — 888 stops with the modes and routes that actually serve them
- `routes.json` — 45 routes (7 train lines, 38 bus routes) with official colours
- `schedule/YYYYMMDD.json` — one file per service day
- `meta.json` — feed version and coverage

The GTFS feed covers a fixed window (the snapshot used here runs 2026-09-17 → 2026-11-27), so
**re-run `npm run gtfs:build` periodically**; it fails loudly if the feed no longer covers
today. Flags: `--days N` (default 10), `--zip path/to/GO_GTFS.zip` to build from a local copy.

### Environment

| Variable | Purpose |
| --- | --- |
| `TRANSIT_PROVIDER` | `gotracker` (default) or `metrolinx` |
| `GOTRACKER_BASE_URL` | Temporary upstream base |
| `GOTRACKER_REFERER` | Required — the upstream 403s without it |
| `METROLINX_API_BASE_URL` / `METROLINX_API_KEY` | Official API. Setting just the key turns on platform numbers, without switching providers |
| `LIVE_VEHICLE_REFRESH_SECONDS` / `STATION_REFRESH_SECONDS` | Server-side cache TTLs |
| `UPSTREAM_TIMEOUT_MS`, `STALE_AFTER_SECONDS` | Timeout, and when data stops being called live |
| `ENABLE_DEV_TRANSIT_PAGE` | Gates `/dev/transit`; 404s in production unless `true` |
| `GOTRACKER_LIVE_BASE_URL` | Mobile proxy base (platform boards). Defaults to the live service |
| `NEXT_PUBLIC_MAP_STYLE_LIGHT` / `_DARK` | Optional MapLibre style overrides |

Never commit `.env.local`.

---

## API

All routes return `{ data, meta }`, where `meta` carries `freshness`, `updatedAt`,
`ageSeconds`, `provider` and an optional `degraded` explanation.

```
GET /api/transit/health
GET /api/transit/stations            ?mode=train|bus  ?near=lat,lon  ?limit=
GET /api/transit/stations/:id
GET /api/transit/stations/:id/departures   ?mode=  ?limit=
GET /api/transit/stations/:id/arrivals     ?mode=  ?limit=
GET /api/transit/vehicles/live       ?mode=  ?routeId=
GET /api/transit/trips/:tripId       (GTFS trip id or bare trip number)
GET /api/transit/routes              ?type=train|bus
GET /api/transit/search              ?q=
GET /api/transit/alerts
GET /api/transit/journeys            ?from=<stopId>&to=<stopId>  ?limit=
```

Ids are validated with Zod, routes are rate limited per IP, upstream errors are sanitized
before they reach the client, and there is no arbitrary URL proxying anywhere — including on
the dev probe endpoint, which only calls fixed operations.

---

## Switching to the official Metrolinx API

```env
TRANSIT_PROVIDER=metrolinx
METROLINX_API_KEY=your_key
```

`MetrolinxOfficialProvider` is written against the published endpoints but **has never seen a
successful response** — without a key every call returns 401. One trap is already handled:
the Metrolinx API answers **HTTP 200 even for auth failures**, with the real status in
`Metadata.ErrorCode`. Before switching over, verify `getDepartures` field names against a real
response and implement `getLiveVehicles` / `getTrip` / `search` (each currently throws rather
than returning invented data). Static stop and route data stays on GTFS either way — the stop
ids match.

---

## Alerts

Derived strictly from live data: services delayed ≥2 min, grouped by route, including the
operator's own `DelayMemo` text when present ("Welland Canal bridge issue"). The upstream
publishes no network alert feed, so none is manufactured — an empty alerts screen means the
data shows no delays.

---

## Features

Trains and buses throughout, with mode-specific icons and never a train icon on a bus.

- **Home** — greeting, search, live vehicle count, delay banner, favourites, nearby (only
  after the user opts in), recently viewed, busiest stops as a fallback
- **Map** — MapLibre, clustered stops, vehicle markers tweened between polls so they glide
  rather than jump, markers collapsing to icons when zoomed out, filters built only from
  services present in the data, tap for a vehicle sheet. `/map?trip=<id>` enters **follow
  mode**: it flies to that vehicle and keeps it centred as it moves, exempt from the filters,
  with a chip naming what is being followed
- **Stations** — 888 stops, mode filter, distance sorting, departures/arrivals tabs. A station
  page covers the whole **site**: GO files a station's bus loop as a separate GTFS stop
  ("Burlington GO" vs "Burlington GO Bus", 96 m apart), so co-located stops are matched by base
  name plus distance and folded into one board — without it, the Burlington ↔ Niagara Falls
  buses were invisible from the station page. Boards
  are **split by travel direction** using GO's own signage wording ("Eastbound towards Union"),
  two columns on wide screens; on a phone a **direction switcher** flips between them, because
  stacking buried the second direction a full screen down. Both directions are always rendered
  and the switcher only governs the narrow layout, so the desktop columns are untouched. At a terminus like Union there
  is only one direction, so the board splits by line instead — as GO's own Union board does.
  Where no signage exists (most bus stops) the direction is taken from GTFS `direction_id` and
  named after the destinations actually in it. Direction colour follows the **compass word**, not the
  sort order: eastbound/northbound is blue and westbound/southbound is purple, always — so a
  direction keeps its colour however the board reorders or refreshes. It appears on the column
  heading, the mobile switcher chip and the card's platform stub, drawn from a palette outside
  the green/amber/red status colours so "which way" never reads as "how late". Groups with no
  compass word (most bus stops, or a terminus split by line) use a separate slate/sand pair so
  they can never be mistaken for east or west. GO's signage only labels the next few trips, so
  when one direction of a line is labelled and the other is not, the other is inferred as its
  opposite (northbound implies southbound) — applied to trains only, and only when exactly one
  of the two is labelled. **The spine belongs to the direction; the line is only a small pill.** Direction is what a
  rider scans a board for and the one thing that differs between two neighbouring Lakeshore
  West cards, so it gets the biggest block: a deep blue spine with a → arrow for eastbound
  (↑ northbound), a deep violet one with ← for westbound (↓ southbound), plus a light wash on
  the body and platform stub. The line (`LW`, `GT`, `12B`) is a small pill in its own GTFS
  colour on a neutral card. An earlier version gave the spine to the line, which painted every
  LW card the same burgundy and forced that burgundy to sit beside blue and purple; the two
  colour systems never harmonised. Arrows are SVG, so direction never depends on colour alone.

  **Buses have a colour of their own** (`BUS_COLOR`, orange-700) and a diagonal-stripe spine.
  GTFS paints bus routes in the same colours as the train corridors they parallel — route 12
  is the same burgundy as Lakeshore West — so a bus read as a train. The override is applied
  where routes are loaded, so boards, journey legs, trip pages and route pages all pick it up;
  the official colours remain in `data/gtfs/routes.json`. The stripes keep a bus identifiable
  for riders who cannot tell the hues apart.

  Each departure is a **boarding pass**: the line's own GO colour on the spine carrying its
  code and mode, the journey in the body, and the platform torn off into a stub behind a
  perforation punched through the card edges. Colour comes from the GTFS route — a Lakeshore
  West card is Lakeshore red — so the app invents no palette of its own here. The card responds
  to its own width with container queries, so a two-column board narrows the spine and stub
  rather than truncating the destination.

  `/dev/card-styles` renders the same live departures in five competing designs (dev-gated,
  like `/dev/transit`); it is kept as a decision aid for future design changes.
  `direction_id` is only compared **within a mode** — a train's "1" and a bus route's "1" are
  unrelated, and sharing the key filed Niagara Falls buses under "Eastbound towards Union"
- **Trips** — a live map that rides with the train at street zoom (fitting the whole corridor
  makes a train look frozen: it covers about a pixel a minute at that scale), panning only when
  the vehicle nears the frame edge so it visibly travels; a "Whole route" toggle; a movement panel
  (moving/stopped, next stop, vehicle number, data age), alerts scoped to that trip's route,
  and a timeline with departed / current / upcoming state
- **Plan a trip** — direct services between two stops, live delay and platform included, and
  **one-change itineraries when no through service exists** (Niagara Falls → Oshawa routes via
  Union). Connections are computed from the timetable: a change needs a stop both legs actually
  call at, with at least 5 minutes to change (10 when it means walking between two stops at one
  site, such as Union's train platforms and its bus terminal), and at most 75 minutes' wait.
  Both ends are treated as sites, so Burlington ↔ Niagara Falls finds the buses from the bus
  loop alongside the train. A change is always labelled, tight ones are flagged, and the card
  says plainly that a late first leg can break the connection
- **Search** — fuzzy across stops, routes and trip numbers; full-screen on mobile. GO stop
  names are dense with abbreviations ("Dundas St. @ Hwy. 407 Park & Ride"), so queries and
  names are both expanded ("highway", "street", "at") before matching, scored just under a
  literal hit. Route results open a **route page** — what is running on it now, plus every
  stop in travel order per direction, taken from the longest trip that day
- **Favourites** — stops, routes and trips in `localStorage`, no account
- **PWA** — installable, app-shell caching, offline page; cached API responses are stamped
  and never labelled live
- **Theming** — light / dark / system with a matching dark basemap, applied before first paint

Map tiles: VersaTiles (OpenStreetMap data), keyless.

---

## Project layout

```
app/                    routes + API handlers
components/             map, stations, departures, trips, vehicles, navigation, search, ui
lib/transit/            types, provider, cache, gtfs, config, parsers/
lib/client/             hooks: polling, favourites, theme, nearby
scripts/build-gtfs.mjs  GTFS → snapshots
data/gtfs/              generated (git-ignored)
legacy-prototype/       the earlier single-file prototype, kept for reference
```

## Verified behaviour

Checked against the live upstream: live vehicles with real delays and reasons, delayed and
on-time rows, schedule-only bus boards, trip timelines tracking a moving train, terminating
trips excluded from departure boards, 404/400 on bad ids, per-IP rate limiting, and full
degradation to schedule-only when the upstream is unreachable (station boards keep working,
the map says `LIVE DATA UNAVAILABLE`, nothing stale is shown as live).

Platforms verified live at Burlington (3/1), Oshawa (1/2), Exhibition (1/4), Union (shared
"7 & 8" plus the deliberate "posted closer to departure"), and Brampton Bus Terminal (7/9)
with live bus delays.

Not yet verifiable: bus *vehicle positions* (no feed publishes them), and the Metrolinx
provider itself, which still needs a key.
