import test from 'node:test';
import assert from 'node:assert/strict';

import { createCalendarConnectStore } from '../../../tools/frontend/calendar/connect_store.mjs';

test('calendar connect store manages sources, feed, and telemetry', () => {
  const store = createCalendarConnectStore({
    sources: [
      {
        srcId: 'cxs_1',
        kind: 'ics',
        urlOrRemoteId: 'https://example.com/a.ics',
        status: 'active',
        createdAt: '2025-01-01T00:00:00Z'
      }
    ],
    feed: {
      id: 'ifd_1',
      token: 'feed-token',
      includeHolds: false
    }
  });

  const states = [];
  const unsubscribe = store.subscribe((state) => {
    states.push(state);
  });

  const initial = store.getState();
  assert.equal(initial.orderedSourceIds.length, 1);
  assert.equal(initial.feed.token, 'feed-token');

  store.upsertSource({
    srcId: 'cxs_1',
    status: 'paused',
    lastPollAt: '2025-01-02T10:00:00Z'
  });
  let updated = store.getState();
  assert.equal(updated.sourcesById.cxs_1.status, 'paused');

  store.markSyncResult({
    srcId: 'cxs_1',
    status: 'ok',
    fetchedAt: '2025-01-02T10:05:00Z',
    eventCount: 12
  });
  updated = store.getState();
  assert.equal(updated.sourcesById.cxs_1.lastImportedCount, 12);
  assert.equal(updated.syncSummary.cxs_1.okCount, 1);

  store.recordError({
    srcId: 'cxs_1',
    message: 'ETag mismatch',
    retriable: true
  });
  updated = store.getState();
  assert.equal(updated.errorLog.length, 1);
  assert.equal(updated.errorLog[0].message, 'ETag mismatch');

  store.recordTelemetry({ type: 'SYNC_RETRY', srcId: 'cxs_1' });
  updated = store.getState();
  assert.equal(updated.telemetry[0].type, 'SYNC_RETRY');

  store.setFeed({
    id: 'ifd_1',
    token: 'feed-token-2',
    includeHolds: true
  });
  updated = store.getState();
  assert.equal(updated.feed.token, 'feed-token-2');
  assert.equal(updated.feed.includeHolds, true);

  store.removeSource('cxs_1');
  updated = store.getState();
  assert.equal(updated.orderedSourceIds.length, 0);

  unsubscribe();
  assert.ok(states.length >= 5);
});
