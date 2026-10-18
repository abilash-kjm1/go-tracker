import { describe, expect, it } from 'vitest';
import { cleanSubscription, deviceId } from '@/lib/transit/pushDevice';

const P256DH = 'B'.repeat(87);
const AUTH = 'A'.repeat(22);
const sub = (endpoint: string, keys = { p256dh: P256DH, auth: AUTH }) => ({ endpoint, keys });

const FCM = 'https://fcm.googleapis.com/fcm/send/abc123';
const APPLE = 'https://web.push.apple.com/QWERTY';
const MOZILLA = 'https://updates.push.services.mozilla.com/wpush/v2/xyz';

describe('cleanSubscription', () => {
  it('accepts the push services browsers actually use', () => {
    for (const endpoint of [FCM, APPLE, MOZILLA, 'https://sin.notify.windows.com/w/?token=x']) {
      expect(cleanSubscription(sub(endpoint)), endpoint).not.toBeNull();
    }
  });

  it('returns the subscription unchanged when it is usable', () => {
    expect(cleanSubscription(sub(FCM))).toEqual({
      endpoint: FCM,
      keys: { p256dh: P256DH, auth: AUTH },
    });
  });

  // The reason this exists: the watch endpoint took any https URL, so a forged
  // request could make the server sign and post wherever the sender liked.
  it('refuses an endpoint that is not a push service', () => {
    expect(cleanSubscription(sub('https://evil.example.com/collect'))).toBeNull();
    expect(cleanSubscription(sub('https://fcm.googleapis.com.evil.test/x'))).toBeNull();
    expect(cleanSubscription(sub('https://notfcm.googleapis.com/x'))).toBeNull();
  });

  it('refuses anything that is not plain https on the default port', () => {
    expect(cleanSubscription(sub('http://fcm.googleapis.com/fcm/send/x'))).toBeNull();
    expect(cleanSubscription(sub('https://fcm.googleapis.com:8443/fcm/send/x'))).toBeNull();
    expect(cleanSubscription(sub('https://user:pw@fcm.googleapis.com/fcm/send/x'))).toBeNull();
  });

  it('refuses keys that no browser would have produced', () => {
    expect(cleanSubscription(sub(FCM, { p256dh: 'short', auth: AUTH }))).toBeNull();
    expect(cleanSubscription(sub(FCM, { p256dh: P256DH, auth: 'short' }))).toBeNull();
    expect(cleanSubscription(sub(FCM, { p256dh: 'B'.repeat(200), auth: AUTH }))).toBeNull();
    // base64url only: a '+' or '/' did not come from a browser's subscription.
    expect(cleanSubscription(sub(FCM, { p256dh: `${'B'.repeat(86)}+`, auth: AUTH }))).toBeNull();
  });

  it('refuses a subscription with pieces missing', () => {
    expect(cleanSubscription(null)).toBeNull();
    expect(cleanSubscription({})).toBeNull();
    expect(cleanSubscription({ endpoint: FCM })).toBeNull();
    expect(cleanSubscription(sub(''))).toBeNull();
    expect(cleanSubscription('a string')).toBeNull();
  });

  it('refuses an endpoint long enough to be an attack on the store', () => {
    expect(cleanSubscription(sub(`https://fcm.googleapis.com/${'x'.repeat(1200)}`))).toBeNull();
  });

  it('trims surrounding whitespace rather than rejecting over it', () => {
    expect(cleanSubscription(sub(`  ${FCM}  `))?.endpoint).toBe(FCM);
  });
});

describe('deviceId', () => {
  it('is stable for one push address', () => {
    expect(deviceId(FCM)).toBe(deviceId(FCM));
  });

  it('differs between two', () => {
    expect(deviceId(FCM)).not.toBe(deviceId(APPLE));
  });

  // Turning notifications on twice must update one record, not leave two.
  it('is short and safe to use as a store key', () => {
    const id = deviceId(FCM);
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
