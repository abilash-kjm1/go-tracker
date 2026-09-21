# GO Tracker

Live GO Transit departure board, backed by the [Metrolinx Open Data API](https://api.openmetrolinx.com/OpenDataAPI/Help/Index/en).

Zero npm dependencies — a small Node server proxies Metrolinx (so the API key stays server-side
and the browser avoids CORS) and serves a static front end.

## Setup

1. Register for a Metrolinx Open Data key. Approval can take up to 10 business days.
2. Configure it:

```bash
cp .env.example .env
```

Put your key in `.env` as `GO_API_KEY`, then:

```bash
npm start
```

Open http://localhost:3000, type a station name (e.g. `Union`), and the board fills in.
Your last station is remembered in `localStorage`.

## How it works

| Route | Upstream | Cache |
| --- | --- | --- |
| `GET /api/stations` | `api/V1/Stop/All` | 24h |
| `GET /api/departures/:stopCode` | `api/V1/Stop/NextService/{code}` | 30s |
| `GET /api/health` | — | — |

The browser polls departures every 60s and re-renders countdowns every 15s in between.
Delay is computed as `ComputedDepartureTime - ScheduledDepartureTime`.

Note: Metrolinx returns HTTP 200 even for auth failures, with the real status in
`Metadata.ErrorCode` — the server checks that and surfaces it (a bad key shows as a 401 banner
in the UI).

## Next steps

Ideas the current structure leaves room for:

- Live map via the GTFS-realtime feeds (`api/V1/Gtfs/Feed/VehiclePosition`, `TripUpdates`)
- Service alerts banner (`api/V1/Gtfs/Feed/Alerts`)
- Whole-network view (`api/V1/ServiceataGlance/Trains/All`)
