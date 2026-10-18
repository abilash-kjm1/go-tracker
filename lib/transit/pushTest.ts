import 'server-only';

import { list, put, remove } from '../server/store';
import { deviceId, type PushSubscriptionRecord } from './pushDevice';

/**
 * "Send a test to this phone" — a real one, from the server.
 *
 * The button already in Settings calls showNotification() in the page, which
 * proves the phone can display a notification and nothing else. It does not
 * touch the server, the signing key, the push service, or the service worker
 * waking with the app shut — which is every part that can actually be broken.
 * So a rider who got no alerts could tap it, watch it work, and be no wiser.
 *
 * This takes the whole path instead. The request only writes down that a test
 * is wanted; the scheduler sends it on its next pass, up to a minute later,
 * by which time the rider has put the phone in their pocket. If it arrives,
 * every link in the chain works, with the app closed, on that handset. If it
 * does not, the fault is somewhere real and worth hunting.
 */

const SET = 'push-test';

/** A test older than this was never going to be any use. */
const EXPIRES_MS = 10 * 60_000;

export interface PendingTest {
  subscription: PushSubscriptionRecord;
  requestedAt: number;
}

export async function queueTest(subscription: PushSubscriptionRecord): Promise<void> {
  await put(SET, deviceId(subscription.endpoint), {
    subscription,
    requestedAt: Date.now(),
  } satisfies PendingTest);
}

export async function listTests(): Promise<Array<{ key: string; value: PendingTest }>> {
  return list<PendingTest>(SET);
}

export async function dropTest(key: string): Promise<void> {
  await remove(SET, key);
}

export function testExpired(test: PendingTest, now = Date.now()): boolean {
  return now - test.requestedAt > EXPIRES_MS;
}

/** What the test says when it lands. It has one job: be unmistakable. */
export function testMessage() {
  return {
    title: '✅ GO Tracker can reach you',
    body: 'This came from the server with the app closed. Platform and stop alerts will arrive the same way.',
    url: '/more',
    tag: 'gotracker-server-test',
  };
}
