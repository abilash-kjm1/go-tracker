import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The GTFS snapshot is gitignored and read with fs at runtime, so it has to be
  // traced into the serverless bundle of EVERY route that touches it. Pages
  // read it directly (the station page, the map, the planner), not just the API
  // routes, so this matches all of them rather than a hand-picked list that
  // silently misses the next page someone adds.
  outputFileTracingIncludes: {
    '/**/*': ['./data/gtfs/**'],
  },
};

export default config;
