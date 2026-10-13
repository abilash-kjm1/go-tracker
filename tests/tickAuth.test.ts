import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireTickSecret } from '@/lib/transit/tickAuth';

/**
 * The only thing standing between the public internet and the scheduler
 * endpoint, so it is worth asserting rather than assuming.
 */

const SECRET = 'correct-horse-battery-staple';
const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe('requireTickSecret', () => {
  beforeEach(() => {
    process.env.PUSH_TICK_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.PUSH_TICK_SECRET;
  });

  it('lets a correct query-string secret through', () => {
    expect(requireTickSecret(req(`https://x.test/api?key=${SECRET}`))).toBeNull();
  });

  it('lets a correct bearer token through', () => {
    expect(
      requireTickSecret(req('https://x.test/api', { authorization: `Bearer ${SECRET}` })),
    ).toBeNull();
  });

  it('accepts a bare authorization value without the Bearer prefix', () => {
    expect(requireTickSecret(req('https://x.test/api', { authorization: SECRET }))).toBeNull();
  });

  it('prefers the header when both are supplied', () => {
    const denied = requireTickSecret(
      req(`https://x.test/api?key=${SECRET}`, { authorization: 'Bearer wrong' }),
    );
    expect(denied?.status).toBe(401);
  });

  it('rejects a wrong secret', () => {
    expect(requireTickSecret(req('https://x.test/api?key=nope'))?.status).toBe(401);
  });

  it('rejects a missing secret', () => {
    expect(requireTickSecret(req('https://x.test/api'))?.status).toBe(401);
  });

  it('rejects a correct prefix', () => {
    // The failure mode a non-constant-time compare invites.
    expect(requireTickSecret(req(`https://x.test/api?key=${SECRET.slice(0, -1)}`))?.status).toBe(
      401,
    );
  });

  it('rejects a value that merely starts with the secret', () => {
    expect(requireTickSecret(req(`https://x.test/api?key=${SECRET}extra`))?.status).toBe(401);
  });

  it('rejects an empty string even against an empty-ish guess', () => {
    expect(requireTickSecret(req('https://x.test/api?key='))?.status).toBe(401);
  });

  it('refuses everything when the server has no secret configured', () => {
    delete process.env.PUSH_TICK_SECRET;
    // 503, not 401: the endpoint is misconfigured, not the caller unauthorised.
    expect(requireTickSecret(req(`https://x.test/api?key=${SECRET}`))?.status).toBe(503);
  });

  it('handles a guess far longer than the secret without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so the padding has to cover
    // a guess longer than the fixed width too.
    const long = 'x'.repeat(5000);
    expect(requireTickSecret(req(`https://x.test/api?key=${long}`))?.status).toBe(401);
  });
});
