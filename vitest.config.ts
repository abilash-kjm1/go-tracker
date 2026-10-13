import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Tests run in UTC on purpose.
 *
 * The app's whole timezone problem is that GO runs on Toronto local time while
 * the server runs anywhere — Vercel is UTC. A suite that passes only on a
 * machine already set to Toronto would prove nothing about production.
 */
process.env.TZ = 'UTC';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
