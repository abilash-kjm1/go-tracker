# Deploying GO Tracker to Vercel (free)

Everything below runs on Vercel's free **Hobby** plan. No environment variables are
required: every default already points at the right place.

## 1. Put the code on GitHub

```bash
cd go-tracker
git init
git add .
git commit -m "GO Tracker"
git branch -M main
# create an empty repo on github.com first, then:
git remote add origin https://github.com/<you>/go-tracker.git
git push -u origin main
```

`.env.local` and the generated `data/gtfs/` folder are git-ignored on purpose. The
timetable is rebuilt on every deploy, not stored in the repo.

## 2. Import it on Vercel

1. vercel.com -> **Add New -> Project** -> pick the repo.
2. Framework is detected as Next.js. Leave every setting alone: `vercel.json` and the
   `vercel-build` script already set the region (`cle1`, Cleveland, closest to Toronto) and
   the build (`download GO timetable -> next build`, about 10 s).
3. **Deploy.** You get `https://<name>.vercel.app`, over HTTPS, which is what makes
   "Add to Home Screen" and the location button work on phones.

## 3. Keep the timetable fresh (do this once)

The timetable is baked in at build time and covers 14 days, so the site must be redeployed
regularly. A GitHub Action does that daily:

1. Vercel -> Project -> **Settings -> Git -> Deploy Hooks** -> create `daily-refresh` on
   `main`. Copy the URL.
2. GitHub -> repo -> **Settings -> Secrets and variables -> Actions -> New secret**:
   name `VERCEL_DEPLOY_HOOK`, value = that URL.

If a refresh ever fails (the GO download is down), the previous deployment keeps serving,
so the site never goes blank.

## What makes it fast

- **Edge caching.** API responses carry `s-maxage` (10 s for vehicle positions, 15 s for
  boards, 5 min for search, 1 h for static data), so a crowd watching one station costs one
  function run per interval, not one per person. Errors are never cached.
- **Region.** Functions run in Cleveland, a few ms from the GO servers they call.
- **Timetable in memory.** After a cold start each instance parses a day's schedule once.

## What makes it accurate

- The server runs in **UTC**, but every schedule calculation uses `America/Toronto`
  explicitly. Verified: identical departure and arrival instants on a UTC clock and a
  Toronto clock.
- Cached data is bounded (at most about 45 s for boards) and every payload carries its own
  `updatedAt`, so the LIVE / DATA DELAYED label reflects the real age of the data.
- If GO's live feeds are unreachable the app falls back to the published timetable and says
  so on screen; it never shows cached data as live.

## Known limits (worth knowing before you share the link)

- **Live data comes from gotracker.ca, an unofficial service.** It has no published terms
  and could change or block datacentre traffic without notice. The provider layer is built
  so an official Metrolinx key (`TRANSIT_PROVIDER=metrolinx`, `METROLINX_API_KEY`) can
  replace it without touching the UI. Check the live map after your first deploy: if it
  reads "LIVE DATA UNAVAILABLE" while stations still work, Vercel's IPs are being refused.
- **Free tier fair use.** Hobby is for personal, non-commercial use. Sharing it with friends
  is fine; running it as a public product is not.
- **Bus positions do not exist** in any feed, so buses are timetable-only apart from the
  terminals that publish live platforms and delays.
- Map tiles come from VersaTiles, which is free and keyless but not a paid SLA.
