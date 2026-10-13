# GO Tracker

An independent, real-time progressive web app for **GO Transit** (Metrolinx, Greater Toronto and Hamilton Area). Live train and bus positions, station departure boards with platform numbers, multi-leg journey planning, and push notifications that reach a locked phone.

> Not operated by or affiliated with Metrolinx or GO Transit.

---

## Contents

- [What it does](#what-it-does)
- [Tech stack](#tech-stack)
- [What the upstream data actually provides](#what-the-upstream-data-actually-provides)
- [Architecture](#architecture)
- [The GTFS build step](#the-gtfs-build-step)
- [Domain model](#domain-model)
- [Feature reference](#feature-reference)
- [HTTP API](#http-api)
- [Caching](#caching)
- [Push notifications](#push-notifications)
- [Client-side state](#client-side-state)
- [Design system and theming](#design-system-and-theming)
- [Configuration](#configuration)
- [Running locally](#running-locally)
- [Deployment and scheduled jobs](#deployment-and-scheduled-jobs)
- [Switching to the official Metrolinx API](#switching-to-the-official-metrolinx-api)
- [Upstream quirks worth knowing](#upstream-quirks-worth-knowing)
- [Known gaps and limitations](#known-gaps-and-limitations)
- [Repository map](#repository-map)

---

## What it does

GO Transit's own app shows a timetable. This one tries to answer the questions a rider actually has while standing on a platform or sitting on a bus:

| Question | How it is answered |
|---|---|
| Where is my train right now? | Live map, markers tweened between position updates |
| Which platform? | Live signage boards, with *expected* and *confirmed* shown differently |
| Will I make my connection? | Connection search with real minimum-transfer buffers |
| When do I need to leave the house? | Walk-time estimate from the rider's position to the stop |
| Has my stop come up yet? | Trip timeline with the vehicle's live position drawn on the line |
| Will I be told while my phone is locked? | Web Push, driven by an external one-minute scheduler |

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, React 19, server components) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 (`@theme`, `@utility`, CSS custom properties) |
| Maps | MapLibre GL 5 + VersaTiles basemap (no API key, no Mapbox) |
| Validation | Zod |
| Push | `web-push` (VAPID) |
| Durable store | Upstash Redis over REST (optional; in-memory fallback) |
| XML parsing | `fast-xml-parser` |
| Hosting | Vercel |

Runtime dependencies are deliberately few: `clsx`, `fast-xml-parser`, `maplibre-gl`, `next`, `react`, `react-dom`, `server-only`, `web-push`, `zod`. No UI component library, no state-management library, no data-fetching library — fetching is a ~130-line hook.

---

## What the upstream data actually provides

Every field below was verified against live responses, not documentation. **Read this before changing a parser.**

### There are TWO GO Tracker APIs

| | Legacy SOAP-ish proxy | **Mobile proxy (current)** |
|---|---|---|
| Base | `/GOTracker/web/GODataAPIProxy.svc` | `/gotracker/mobile/proxy/web` |
| Format | XML envelopes (JSON stuffed in `<Data>`) | Clean JSON |
| Auth | Rejects requests without a `Referer` | None needed |
| Station boards | **Broken** — `Error retrieving Station Status from S4!` | Working |
| Platform numbers | None | **Yes — trains and buses** |
| Live positions | Yes (trains only) | — |

`gotracker.ca` is alive and runs on the mobile proxy. The legacy `.svc` service is still up but its station-status backend is dead, which is why platforms looked impossible until the live site was inspected directly.

**The app uses both**: the legacy service for live train positions, the mobile proxy for boards and platforms. Both are keyless.

### Mobile proxy endpoints in use

```
Messages/Signage/Rail/{corridorCode}/{stationCode}   platform + expected time per train
Messages/Departures/UN                               Union's own board (see below)
Messages/Signage/Bus/{terminalCode}                  platform + delay per bus, by bay
Info/Places/BusTerminal                              the ~16 terminals with live bay data
```

Discovered but not yet used: `Info/TripPatterns/{Train,Bus}`, `Schedule/Today/All`, `Schedule/Today/Trip/{n}`, `Messages/Signage/Bus/TripDetail/{n}`, `Messages/Departures/USBT/{n}`, and a SignalR hub broadcasting `RailOccupancy.Coach.Update` (live seat occupancy — a promising unused feature).

### Five things worth knowing

1. **Rail signage is per corridor.** `Messages/Signage/Rail/LW/BU` works; `ALL/BU` returns zero trips. Corridor codes come from the GTFS route id suffix (`…-LW`, `…-GT`).

2. **Union is special.** It publishes no corridor signage at all — use `Messages/Departures/UN`. Its `platform` field is literally `"-"` with `info: "Wait / Attendez"` until GO assigns one, which the UI surfaces as *"Platform posted closer to departure"* rather than a blank. Long trains get shared assignments like `"7 & 8"`.

3. **Buses have live platforms and delays** via terminal signage — `schTrack`/`actTrack`, `delaySecond`, `expDepartureTimestamp`, `isCancelled`. Each row carries the GTFS `stopCode` of its bay, which is how a bay lands on the right stop. Only the ~16 terminals in `Info/Places/BusTerminal` publish this; every other bus stop stays schedule-only. GTFS bus stops are matched to a terminal by position (≤500 m).

4. **GO labels the column "Pltfrm" for buses too**, so both modes say "Platform N" — matching the wording riders see on GO's own screens.

5. **`TripLocation` (legacy) returns trains only.** Every observed row carries `Source="T"`; only `ALL` works as a service code. The parser maps `T`→train and `B`/`C`→bus so bus rows would flow through if they ever appear. Live *bus positions* reach the app through the official Metrolinx API instead.

### The optional Metrolinx Open Data API

A free API key is not required, but adds two things the GO Tracker upstreams cannot give:

- **`ServiceataGlance/Buses/All`** — live bus positions (~200 vehicles). GO Tracker publishes no bus positions at all, so without a key half the network is timetable-only on the map.
- **`Stop/NextService/{stopId}`** — `ScheduledPlatform` (the plan) alongside `ActualPlatform` (the decision), which is what lets the UI distinguish *expected* from *confirmed*.

These are wired as standalone "sources", not as a provider, so a key enriches the existing provider rather than replacing it. With no key both are inert, and the app simply shows no bus positions and only confirmed platforms.

### Route variants

GO runs lettered variants of a bus route — 12, 12B and 12D sit under route 12 but serve different stops, and the letter is what is written on the front of the bus. GTFS carries this in `trips.route_variant` (repeated in `trip_headsign`, "12B - Burlington GO"), so the snapshot keeps it per trip and the UI badges the variant while filters and grouping still work off the parent route. Searching "12B" finds route 12.

The headsign is also the rider-facing destination — "Burlington GO", where the terminus stop is internally named "Burlington GO Bus" — so boards and trip pages prefer it.

### How departures are built

Departure boards are the **GTFS schedule with the live board merged on by trip number**. GTFS trip ids look like `20260920-LW-1639`, where the tail is the public trip number both upstreams use — that join is what lets a platform, expected time and delay land on a scheduled row.

The schedule is what gives full coverage: 38 bus routes and 817 bus-only stops that no real-time feed mentions still get a board, marked `SCHEDULED`. Where a signage board exists, rows gain a platform and turn `LIVE`.

Rows are never dressed up: a row is `realtime` only when a live vehicle or station-status row backs it.

---

## Architecture

```
Frontend (app/, components/)
      ↓  our API only — never the upstream directly
Route handlers (app/api/transit/*)      zod-validated, rate limited, CDN-cached
      ↓
TransitDataProvider  (lib/transit/provider.ts)
      ├── GoTrackerTemporaryProvider   — live today
      └── MetrolinxOfficialProvider    — wired, unverified
      ↓
TTL cache + request coalescing (lib/transit/cache.ts)
      ↓
┌─ legacy .svc        → live train positions
├─ mobile proxy       → platform boards, rail + bus   (keyless)
├─ Metrolinx API      → bus positions + expected platform  (optional key)
└─ GTFS snapshot      → stops, routes, schedule       (data/gtfs/, build-time)
```

### Key decisions

**A provider seam.** Everything the UI renders comes from the normalized types in `lib/transit/types.ts`; no upstream-specific field ever reaches a component. Swapping data sources means implementing `TransitDataProvider` — no route-handler or component changes. `getProvider()` dynamically imports the chosen implementation, so the unused one never enters the bundle.

**Schedule as baseline, live data as a delta.** Live delays are applied on top of scheduled times, so the app degrades to a correct timetable rather than to nothing.

**Freshness is always carried, never implied.** Every response is wrapped:

```ts
{
  data: T,
  meta: {
    freshness: 'live' | 'stale' | 'unavailable' | 'scheduled',
    updatedAt: string | null,
    ageSeconds: number | null,
    provider: string,
    degraded?: string   // set when live failed and this is schedule-only
  }
}
```

**Nothing is invented.** No published platform means no platform shown. No matched trip means no next stop reported. The failure mode this guards against — a confidently wrong platform number — is worse than an absent one.

**Security posture.** Ids are zod-validated, routes are rate limited per IP (`rateLimit()`, default 120/min), upstream errors are sanitized before reaching the client, and there is no arbitrary URL proxying anywhere — including the dev probe, which only calls fixed operations.

---

## The GTFS build step

```bash
npm run gtfs:build                                   # downloads the feed (~22 MB)
npm run gtfs:build -- --days 21 --zip ./GO-GTFS.zip  # custom window / local copy
```

Runs automatically as part of the deploy:

```json
"vercel-build": "node scripts/build-gtfs.mjs && next build"
```

Output (git-ignored, ~7.5 MB):

```
data/gtfs/
  meta.json              feed version, generation time, dates available
  stops.json             888 stops: id, name, code, lat, lon, modes, routeIds, wheelchair, url
  routes.json            45 routes (7 train lines, 38 bus routes) with official colours
  schedule/YYYYMMDD.json one file per service day
```

Trip fields are single letters to keep files small — they are read on every cold start:
`i` id, `n` trip number, `r` route id, `h` headsign, `v` variant (`12B`), `d` direction, `s` stop times as `[stopId, arrivalSeconds, departureSeconds]`.

Default window is **14 days** (`--days`). The script fails loudly if the feed no longer covers today.

> Because the snapshot is baked into the build, the timetable only stays current if the site is **redeployed**. A GitHub Actions workflow does this daily. `next.config.ts` traces `data/gtfs/**` into every route's serverless bundle, because pages read it directly, not just API routes.

---

## Domain model

All in `lib/transit/types.ts`.

**`TransitStop`** — `id, name, code, lat, lon, modes[], routeIds[], wheelchair?, url?`

**`LiveVehicle`** — position, `delaySeconds`, `isMoving`, `express`, `nextStopId`/`nextStopName`, `atStopId` (the stop it is standing at), `detail`, `delayReason`, `vehicleLabel`, `updatedAt`.

**`Departure`** — the richest type. Beyond the obvious:
- `serviceCode` — what is on the front of the bus (`12B`), distinct from `routeCode` (`12`)
- `platform` vs `expectedPlatform` — a confirmed assignment vs a published plan, deliberately separate
- `platformNote` — e.g. Union withholding the platform until close to departure
- `directionLabel` — GO's own signage wording ("Eastbound towards Union")
- `arrivalTime`, `arrivalStopName`, `durationMinutes` — for journey legs
- `realtime` — whether these times are backed by live data

**`Journey`** — `legs: Departure[]`, `transfers`, `connectionMinutes[]`, `durationMinutes`, `realtime`.

**`TripDetail`** — metadata plus `stops: TripStopTime[]`, each with `status: 'departed' | 'current' | 'next' | 'upcoming'` and coordinates, so the timeline can draw the vehicle on the line.

**`TransitAlert`** — `severity`, `title`, `body`, `scope: { kind: 'route'|'stop'|'trip'|'network', id?, name? }`.

**`ProviderHealth`** — connection state, latency, counts, GTFS metadata, staleness, whether a platform source is configured.

---

## Feature reference

### Home (`/`)

- **Journey planner front and centre** — from/to with swap, "Leave now" or "Pick a day" for future-day planning
- Results inline, with legs, changes and connection buffers
- Network alerts strip, tapping through to `/alerts`
- Four compact shortcuts: Map, Stations, Lines, Alerts (with a count badge)
- **Favourites** with live next-departure cards
- **Nearby** (only after the rider grants location)
- Falls back to "Recently viewed", then "Busiest today"
- One-line network summary (`N trains running · M late · K buses`) expanding into a live list filterable by line

### Live map (`/map`)

- MapLibre GL, VersaTiles basemap, separate light and dark styles
- Every live vehicle as a DOM marker, **tweened** between updates so movement is continuous rather than teleporting
- Markers coloured by line; lateness is a separate amber tag, never a change of line colour
- Filters: All / Trains / Buses, plus per-service filtering
- Tapping a vehicle opens a sheet and draws its route with its stops
- **The rider's own vehicle is ringed** when a trip is active, so it is findable among a hundred others
- Labels collapse when zoomed out

### Stations (`/stations`, `/stations/[stationId]`)

- Browse all 888 stops, filter by name, segmented All / Trains / Buses
- **Pinned stations** kept at the top, toggled with a star
- Rail stations get an accent gradient tile, roadside bus stops a sunken grey one — the two kinds are distinguishable before the name is read
- Search-match highlighting inside names, which matters where a dozen stops share a street
- Staggered entrance animation, press states, reduced-motion respected
- **Station page**: departures/arrivals toggle, mode filter, live indicator, departures grouped by travel direction the way GO's own station screens do
- Co-located stops folded into one board (GO files `Burlington GO` and `Burlington GO Bus` separately)

### "Leave by" (walk time)

On a station page, with location granted:

```
🚶 Leave by 11:26 for the 11:47 a.m. to Confederation
   21 min walk · 1.2 km — estimated
```

- Finds the **first departure that walk can still reach** — it never offers a service you cannot make
- Within 150 m: "You're at the stop", plus a countdown to the next one that has not already left
- Beyond 5 km: declines to give a walk time rather than pretending
- Estimate: straight-line distance × 1.35 (street detour) at 4.8 km/h
- Location is never requested on first paint — only on tap, or when the browser already reports permission. A refusal is silent and final.

### Departure cards

- Slim colour spine per direction
- Service code badge (`LW`, `21C`, `16`), route name, express flag
- Scheduled time with the live estimate beside it when they differ
- Delay state, arrival time, duration
- **Platform column with three distinct states**: confirmed `PLATFORM 12`; a dashed `EXPECTED 12 / NOT CONFIRMED`; or a board note such as Union's "posted closer to departure"
- Cancellations rendered distinctly
- Per-row platform alert button

### Trip view (`/trips/[tripId]`)

Accepts a GTFS trip id or a bare trip number.

- Full stop timeline with live status per stop
- **The position dot travels along the line between stations and sits on the circle when the vehicle is standing at one**, computed by projecting the vehicle's GPS onto the leg
- Passed stops fold away by default
- Per-stop alert bells
- Live vehicle detail and the operator's delay reason when published
- Trip-scoped service alerts, inline mini-map

### Journey planning (`/plan`, and inline on home)

- Direct services plus connections, up to **2 changes**
- Time-expanded search where rounds correspond to legs
- Minimum connection buffers: **5 min** at the same stop, **10 min** across a site (rail platform → bus loop), maximum **75 min** before a connection stops counting as one
- **All catchable last-leg variants are shown**, so a rider sees both the `12` and the `12B` and chooses
- Future-day planning
- Sorted by departure then arrival, with a per-departure cap so one service cannot fill the list
- Clear disambiguation when two journeys leave at the same minute

### Active trip (`/my-trip`)

- Start a trip from a planned journey; **one at a time**
- A follow bar appears on **every screen** with live progress
- **Automatic alerts** armed: two stops before the destination, the stop before, the destination itself, and — on a journey with a change — the stop before the interchange
- Optional screen Wake Lock
- Ending the trip clears its local alerts and drops its server watches

### Alerts (`/alerts`)

**Derived strictly from live data** — services delayed ≥2 min, grouped by route, including the operator's own `DelayMemo` text when present ("Welland Canal bridge issue"). The upstream publishes no network alert feed, so none is manufactured: an empty alerts screen means the data shows no delays.

### Lines (`/routes`, `/routes/[routeId]`)

Per-line pages with a line diagram, the live vehicles on that route, and the route's stops.

### Favourites (`/favorites`)

Starred stops, trips and lines with live departure summaries. Recent stops are tracked automatically.

### The signal dangle

A hanging **railway signal lens** in the top-right corner with spring physics — it swings when pulled and settles. Tap rotates to the next configured station; long-press opens it. Configurable in settings, larger on mobile.

### PWA

- Installable to the iOS/Android home screen (required on iOS before notifications are permitted at all)
- Service worker caches the app shell (`/`, `/map`, `/stations`, `/favorites`, `/offline`) and is network-first for API responses, stamping `x-gt-cached-at` so a cached response is never presented as live
- Offline fallback page
- Manifest with maskable icons and shortcuts to Live map and Favourites
- Light/dark theme with a manual override

---

## HTTP API

All responses use the envelope above. All handlers are `force-dynamic`.

```
GET /api/transit/health
GET /api/transit/stations                   ?mode=train|bus  ?near=lat,lon  ?limit=
GET /api/transit/stations/:id
GET /api/transit/stations/:id/departures    ?mode=  ?limit=
GET /api/transit/stations/:id/arrivals      ?mode=  ?limit=
GET /api/transit/trips/:tripId              (GTFS trip id or bare trip number)
GET /api/transit/vehicles/live              ?mode=  ?routeId=
GET /api/transit/routes                     ?type=train|bus
GET /api/transit/journeys                   ?from=&to=  ?at=  ?limit=
GET /api/transit/search                     ?q=
GET /api/transit/alerts
GET /api/transit/calendar
```

Push endpoints (not part of the public data API):

| Endpoint | Purpose |
|---|---|
| `POST /api/push/watch` | Register a platform or arrival watch |
| `DELETE /api/push/watch` | Drop a watch |
| `GET /api/push/tick?key=…` | Secret-gated; called by an external scheduler every minute |
| `GET /api/push/debug?key=…` | Secret-gated diagnostics; never returns the push subscription itself |

Dev-only: `/api/dev/probe`, `/dev/transit`, `/dev/card-styles` — gated by `ENABLE_DEV_TRANSIT_PAGE`, on by default outside production.

---

## Caching

**Server-side TTL cache with in-flight coalescing** (`lib/transit/cache.ts`): one hundred people watching one station produce one upstream request. On failure the last good value keeps being served, marked stale, rather than blanking the UI.

**CDN cache headers** per data tier (`lib/transit/api.ts`):

| Tier | Policy | Why |
|---|---|---|
| `live` | `s-maxage=10, swr=20` | Positions move every ~25s upstream |
| `board` | `s-maxage=15, swr=30` | Timetable blended with live delay |
| `alerts` | `s-maxage=30, swr=60` | |
| `search` | `s-maxage=300, swr=600` | |
| `static` | `s-maxage=3600, swr=86400` | Changes only when the snapshot rebuilds |
| `none` | `no-store` | |

The browser never caches (`max-age=0`), so a reload is always answered by the edge. **Only successes are cached** — an error must never be replayed to everyone.

---

## Push notifications

The hardest part, because iOS suspends a web app's JavaScript the moment it leaves the screen. Anything that must fire while the phone is in a pocket has to come from the server.

```
Rider arms an alert
   └─► registerWatch('arrival'|'platform', {stopId, tripId, tripNumber, departsAt})
        └─► POST /api/push/watch  ──►  Upstash Redis

External scheduler, every 60s
   └─► GET /api/push/tick?key=…
        ├─ list watches, expire anything 10 min past its time
        ├─ platform watches: one board fetch per distinct stop
        ├─ arrival watches:  one trip fetch per distinct trip
        ├─ fire via web-push (VAPID) where the condition is met
        └─ record the run (time, duration, counts, error)

Service worker 'push' ──► showNotification ──► 'notificationclick' ──► deep link
```

**Watch kinds.** `platform` — GO withholds a platform until a few minutes before departure, exactly when nobody is watching a screen. `arrival` — a stop marked on a journey, firing on *approach* where possible, because a notification as the doors open is too late to be useful.

**Wording.** iOS notifications are plain system text: no colour, no fonts. The only emphasis available is the bold title, capitals and an emoji to carry colour — so the platform gets all three and nothing else competes:

```
🟢 PLATFORM 12
Union · LW 1639 at 4:39 p.m.
```

**Durability.** `lib/server/store.ts` uses Upstash Redis over REST when configured, falling back to process memory. On serverless, memory is useless because each request may land on a different instance — so `durable` is exported and the UI never promises what it cannot keep.

**Resilience.** The tick depends on a cold start, two upstream feeds and a metered store, so the occasional run *will* fail and recover a minute later. It therefore:

- keeps a rolling record of the **last 20 runs** readable from `/api/push/debug`
- returns **HTTP 200 for the first two consecutive failures**, 500 only from the third — paging for a blip teaches people to ignore the pager
- uses an **18-second budget**, reporting what it managed rather than risking the scheduler's 30-second timeout
- falls back to an in-process counter when the store itself is what failed

---

## Client-side state

Everything is `localStorage`. There is no account and no server-side profile.

| Key | Holds |
|---|---|
| `gotracker:favorites:v1` | Starred stops, trips, lines |
| `gotracker:recent-stops:v1` | Recently viewed stations |
| `gotracker:recent-journeys:v1` | Recent from/to pairs |
| `gotracker:active-trip:v1` | The one journey in progress |
| `gotracker:stop-alerts:v1` | Armed arrival alerts, with `firedAt` so none repeats |
| `gotracker:platform-watches:v1` | Armed platform alerts |
| `gotracker:dangle-stops:v1`, `gotracker:dangle:v1` | Signal-dangle configuration |
| `gotracker:theme` | Light / dark / system |

Cross-tab sync uses `window` events (`gotracker:favorites-changed`, `gotracker:active-trip`) plus the native `storage` event.

### Hooks

| Hook | Purpose |
|---|---|
| `useTransit<T>(url, {intervalMs})` | Polling fetch with freshness metadata; pauses when the tab is hidden |
| `useTicker(ms)` | Clock for countdowns |
| `useOnline()` | Connectivity |
| `useNearby(limit)` | Nearest stops; only auto-locates if permission was already granted |
| `useWalkTime(target)` | Distance and walking minutes to a stop |
| `useFavorites()` | Star/unstar, cross-tab synced |
| `useActiveTrip()` | The journey in progress; `start()` arms alerts automatically |
| `useWakeLock(enabled)` | Keeps the screen on |
| `useStopAlerts()` / `useStopAlertWatcher()` | Arming and in-page firing |
| `usePlatformAlert(target)` | Platform watch state machine |
| `useTheme()` | Theme preference |

---

## Design system and theming

- Tailwind v4 `@theme` tokens plus custom `@utility` helpers: `surface`, `hairline`, `text-muted`, `text-faint`, `tabular`, `pt-safe`, `pb-safe`, `above-nav`, `scroll-touch`, `no-scrollbar`
- Colours are CSS custom properties redefined for dark mode, so one token drives both themes
- GO's line colours are pure primaries (`#ff0d00` red); softened toward slate in light mode and lifted toward white in dark, so they stay recognisable without glaring
- Bus routes get one distinct colour, because GTFS paints them the same as the rail corridors they parallel and a bus then reads as a train
- Safe-area insets respected throughout (notch, home indicator)
- Every animation sits behind `@media (prefers-reduced-motion: reduce)`
- Map styles overridable with `NEXT_PUBLIC_MAP_STYLE_LIGHT` / `_DARK`

---

## Configuration

**No values appear here — secrets live in `.env.local`, which is git-ignored.**

| Variable | Required | Purpose |
|---|---|---|
| `TRANSIT_PROVIDER` | no | `gotracker` (default) or `metrolinx` |
| `GOTRACKER_BASE_URL` | no | Legacy upstream (train positions) |
| `GOTRACKER_REFERER` | no | The legacy upstream 403s without it |
| `GOTRACKER_LIVE_BASE_URL` | no | Mobile proxy base (platform boards) |
| `GOTRACKER_REFRESH_SECONDS` | no | Default 15 |
| `METROLINX_API_BASE_URL` | no | Has a default |
| `METROLINX_API_KEY` | recommended | Free key. Without it: no bus positions, no *expected* platform |
| `LIVE_VEHICLE_REFRESH_SECONDS` | no | Default 15 |
| `STATION_REFRESH_SECONDS` | no | Default 20 |
| `UPSTREAM_TIMEOUT_MS` | no | Default 10000 |
| `STALE_AFTER_SECONDS` | no | Default 90; older data is labelled "delayed", never "live" |
| `NEXT_PUBLIC_MAP_STYLE_LIGHT` / `_DARK` | no | MapLibre style overrides |
| `ENABLE_DEV_TRANSIT_PAGE` | no | Gates `/dev/transit`; 404s in production unless `true` |
| `GTFS_URL` | no | Override the GTFS feed location |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | for push | **Public by design** — inlined into the client bundle, so set it as a plain config value, not a secret |
| `VAPID_PRIVATE_KEY` | for push | **Secret** |
| `VAPID_SUBJECT` | for push | `mailto:` contact |
| `PUSH_TICK_SECRET` | for push | **Secret**; gates the tick and debug endpoints |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | for push | Or the `KV_REST_API_*` / `REDIS_REST_*` equivalents |

> ⚠️ **A blank value must mean "not set".** Every string setting reads with `||`, not `??`. Hosting dashboards often import empty values from an example file, and `??` treats `""` as a real setting — this once emptied the upstream base URL and broke every live call with "Failed to parse URL".

Note: `.env.example` currently documents only the data variables, not the push ones.

---

## Running locally

```bash
npm install
cp .env.example .env.local     # then fill in your own values
npm run gtfs:build             # downloads the GTFS feed into data/gtfs/
npm run dev                    # http://localhost:3000
```

```bash
npm run build        # next build  (does NOT rebuild GTFS)
npm run vercel-build # gtfs:build + next build — what deploys run
npm start            # serve a production build
npm run typecheck    # tsc --noEmit
npm run lint
```

> The snapshot expires. If departures are empty locally, check `/api/transit/health` → `staticData.datesAvailable` and re-run `npm run gtfs:build`.

---

## Deployment and scheduled jobs

Vercel, with `vercel-build` as the build command so the timetable regenerates on every deployment.

Two external schedulers, because a serverless app cannot wake itself.

**1. Push tick — every minute.** An external scheduler (e.g. cron-job.org) calls `GET /api/push/tick?key=…`. Without this, no notification ever fires.

**2. Schedule refresh — daily.** `.github/workflows/refresh-schedule.yml` POSTs a Vercel deploy hook (`VERCEL_DEPLOY_HOOK` repository secret), re-running `vercel-build` and rolling the 14-day window forward.

The refresh workflow retries five times with backoff (30/60/90/120s), because deploy hooks are rate limited and GitHub fires every repository's scheduled jobs together, so a 429 is ordinary. If all five fail it reads `datesAvailable` from the live site and raises an error **only when fewer than four service days remain** — a missed refresh with thirteen days in hand is not worth waking anyone for. That check needs a repository variable `PRODUCTION_URL`; without it the job errors on any failed trigger, which is the safe default.

GitHub runs scheduled workflows late under load — a job set for 08:30 UTC commonly fires hours later.

---

## Switching to the official Metrolinx API

```env
TRANSIT_PROVIDER=metrolinx
METROLINX_API_KEY=…
```

`MetrolinxOfficialProvider` is written against the published endpoints but **has never seen a successful end-to-end response** as a full provider. One trap is already handled: the Metrolinx API answers **HTTP 200 even for auth failures**, with the real status in `Metadata.ErrorCode`.

Before switching, verify `getDepartures` field names against a real response and implement `getLiveVehicles` / `getTrip` / `search` — each currently throws rather than returning invented data. There is also a `TODO(verify)` to map GTFS-RT `VehiclePosition` entities. Static stop and route data stays on GTFS either way; the stop ids match.

---

## Upstream quirks worth knowing

Found the hard way. The most valuable section here for anyone extending the app.

1. **`AtStationCode` in the bus feed does not mean "at this stop".** Measured against the GPS of 54 live buses, it was the stop *one ahead* in 24 of 24 cases where populated, and 56 of 64 buses it claimed were "at" a stop were more than 300 m away — one 43 km. `NextStopCode` runs one ahead about two-thirds of the time. **Buses are therefore positioned from their own GPS against their own schedule**: within 250 m of a stop with the engine off means standing at it, otherwise the nearest leg's far end is what comes next. `PrevStopCode` lags by one or two stops, so it is used only as a floor — it can say where a bus has definitely been, never where it is.

2. **Trains waiting at a terminus report huge negative delays** (−1100 s and worse). A service never leaves before its timetabled time, so negative delays are clamped to zero — otherwise Union showed departures as having already left.

3. **The bus feed sends `null` for several stop-code fields**, so every zod field there must be `.nullish()`. A strict schema silently yielded zero buses.

4. **Mobile proxy and bus-feed responses carry a UTF-8 BOM**, which `JSON.parse` rejects. Strip it.

5. **`0` and `""` both mean "no stop"** in the bus feed.

6. **Field names invert between rail and bus signage.** In rail signage `tripName` is the *trip number* and `destination` is the destination. In bus signage `tripNumber` is the trip number and `tripName` is the *destination*.

7. **Bus timestamps carry an offset; rail timestamps are bare Toronto local time.**

8. **GTFS times exceed `24:00:00`.** A 00:40 departure belongs to the *previous* service day. All date handling goes through `zonedToInstant` / `currentServiceDate` in `lib/transit/time.ts`, never raw `Date` arithmetic.

9. **GO files one site as multiple stops** — `Burlington GO` (rail) and `Burlington GO Bus` are separate GTFS stops. Boards fold co-located stops via `getRelatedStops`.

10. **The legacy position feed reports `Express="false"` even for runs the boards flag as express**, so it is trusted only when it says `true`.

11. **Boards keep a service listed for a few minutes after it has gone**, so "the first row" is not "the next departure". Anything computing a countdown must filter to future departures.

12. **GTFS paints bus routes with the same colours as the rail corridors they parallel.**

13. **Deploy hooks and scheduled jobs are rate limited.** Expect 429s; retry rather than failing.

---

## Known gaps and limitations

Honest list, for whoever picks this up.

**Test coverage is thin.** Vitest covers `lib/transit/time.ts`, `lib/transit/geo.ts` and the tick's auth gate (57 tests, `npm test`). Nothing yet covers the journey planner, the providers or the parsers. The riskiest remaining code — `lib/transit/time.ts` (timezone and service-day maths) and `lib/transit/journeys.ts` (717 lines of connection search) is `lib/transit/journeys.ts` (717 lines of connection search), which needs GTFS fixtures to test properly.

**27 distinct hard-coded font sizes** (`text-[12px]`, `text-[12.5px]`, `text-[13px]`, …). No typographic scale, so every screen re-invents one. Collapsing to five named utilities would pay for itself quickly.

**Accessibility is thin.** Only two focus-visible rules in the whole app; `aria-live` is nearly absent, so departure times update silently under a screen reader. `TransitStop.wheelchair` exists in the model and is never rendered.

**iOS Live Activities / Dynamic Island are not possible from a PWA.** Web Push on iOS gives notifications and that is the ceiling.

**Not yet built:** delay history ("late 6 of the last 10 weekdays" — arguably the strongest thing a third-party tracker could offer, and the tick already runs every minute so it could record it); line-level alert subscriptions; shareable trip links; live seat occupancy from the discovered SignalR hub; elevator/escalator outages; parking availability; offline departure caching for a favourite stop.

---

## Repository map

```
app/
  page.tsx                   home
  map/ stations/ routes/ alerts/ favorites/ plan/ my-trip/ trips/ more/ about/ offline/
  api/transit/…              public data API
  api/push/{watch,tick,debug}
  layout.tsx  manifest.ts  globals.css

components/
  home/         HomeScreen, RouteScreen, RoutesScreen, AlertsScreen, FavoritesScreen, LineDiagram
  departures/   DepartureBoard, DepartureCard, LeaveBy, PlatformAlertButton, directions
  stations/     StationsBrowser, StationScreen, StationSummaryCard
  trips/        TripScreen, MyTripScreen, JourneyLine, TripMap, ActiveTripBar
  plan/         TripPlanner, JourneyCard, PlanScreen
  map/          LiveMap, MapView, mapStyle
  search/       SearchOverlay
  navigation/   AppShell
  ui/           primitives, Sheet, SignalDangle, LiveIndicator, ThemePicker, ServiceWorker
  vehicles/     VehicleSheet
  settings/     SignalShortcutSettings

lib/
  transit/
    types.ts            the normalized domain model
    provider.ts         the seam
    providers/          GoTrackerTemporaryProvider, MetrolinxOfficialProvider
    sources/            goTrackerBoards (mobile proxy), metrolinxBuses
    parsers/            goTrackerParser (legacy XML), goTrackerLiveParser (signage JSON)
    gtfs.ts             reads the snapshot
    journeys.ts         connection search
    platformSource.ts   optional Metrolinx platform enrichment
    platformWatch.ts    server-side watches + tick
    time.ts  geo.ts  cache.ts  config.ts  api.ts
  client/               React hooks (table above)
  server/store.ts       Upstash-or-memory key-value store

scripts/build-gtfs.mjs  snapshot builder
public/sw.js            service worker
.github/workflows/refresh-schedule.yml
```

---

## Licence and attribution

Independent project. Transit data © Metrolinx, used from publicly available feeds. Basemap © OpenStreetMap contributors, tiles by VersaTiles. Not affiliated with or endorsed by Metrolinx or GO Transit.
