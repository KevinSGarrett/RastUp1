import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNotificationQueue,
  enqueueNotification,
  flushNotifications,
  collectDigest,
  isWithinQuietHours,
  listPendingNotifications
} from '../../../tools/frontend/messaging/notification_queue.mjs';

test('enqueueNotification dedupes within window and flush delivers ready items', () => {
  let state = createNotificationQueue({ dedupeWindowMs: 2 * 60 * 1000 });
  const base = Date.parse('2025-11-19T10:00:00.000Z');
  state = enqueueNotification(
    state,
    {
      threadId: 'thr-123',
      type: 'MESSAGE_CREATED',
      severity: 'normal',
      message: 'New message from Studio'
    },
    { now: base }
  );
  state = enqueueNotification(
    state,
    {
      threadId: 'thr-123',
      type: 'MESSAGE_CREATED',
      message: 'Another new message'
    },
    { now: base + 30_000 }
  );
  const pending = listPendingNotifications(state);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].count, 2);

  const flushed = flushNotifications(state, { now: base + 60_000 });
  assert.equal(flushed.notifications.length, 1);
  assert.equal(flushed.notifications[0].count, 2);
});

test('quiet hours defer notifications unless severity bypassed', () => {
  const quietQueue = createNotificationQueue({
    quietHours: { start: '22:00', end: '07:00', timezoneOffsetMinutes: 0, bypassSeverities: ['CRITICAL'] }
  });
  const nightTime = Date.parse('2025-11-19T23:15:00.000Z');
  let state = enqueueNotification(
    quietQueue,
    {
      threadId: 'thr-xyz',
      type: 'ACTION_CARD',
      severity: 'high',
      message: 'Action card needs review'
    },
    { now: nightTime }
  );
  assert.equal(isWithinQuietHours(state, { now: nightTime }), true);
  let pending = listPendingNotifications(state);
  assert.equal(pending[0].deferred, true);

  // Flush during quiet hours should yield nothing.
  let result = flushNotifications(state, { now: nightTime + 5 * 60 * 1000 });
  assert.equal(result.notifications.length, 0);
  state = result.state;

  // Morning flush should release the deferred item.
  const morning = Date.parse('2025-11-20T08:00:00.000Z');
  result = flushNotifications(state, { now: morning });
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].deferred, false);

  // Critical severity bypasses quiet hours.
  state = enqueueNotification(
    quietQueue,
    {
      threadId: 'thr-urgent',
      type: 'DISPUTE',
      severity: 'critical',
      message: 'Dispute escalated'
    },
    { now: nightTime }
  );
  result = flushNotifications(state, { now: nightTime });
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].severity, 'CRITICAL');
});

test('collectDigest aggregates deferred notifications when digest window elapsed', () => {
  let state = createNotificationQueue({
    quietHours: { start: '21:00', end: '06:00', timezoneOffsetMinutes: 0 },
    digestWindowMs: 15 * 60 * 1000
  });
  const base = Date.parse('2025-11-19T22:00:00.000Z');
  state = enqueueNotification(
    state,
    {
      threadId: 'thr-1',
      type: 'MESSAGE_CREATED',
      severity: 'normal',
      message: 'Message A'
    },
    { now: base }
  );
  state = enqueueNotification(
    state,
    {
      threadId: 'thr-1',
      type: 'MESSAGE_CREATED',
      severity: 'high',
      message: 'Message B'
    },
    { now: base + 1_000 }
  );

  const digest = collectDigest(state, { now: base + 16 * 60 * 1000 });
  assert.equal(digest.length, 1);
  assert.equal(digest[0].threadId, 'thr-1');
  assert.equal(digest[0].count, 2);
  assert.equal(digest[0].highestSeverity, 'HIGH');
  assert.ok(digest[0].sampleMessages.length >= 1);
  assert.ok(digest[0].sampleMessages.includes('Message B'));

  // Subsequent digest within window should not duplicate until more time passes.
  const secondDigest = collectDigest(state, { now: base + 20 * 60 * 1000 });
  assert.equal(secondDigest.length, 0);
});
