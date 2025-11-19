import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCalendarDataSource,
  createStubCalendarClient
} from '../../../web/lib/calendar/dataSource.mjs';

test('stub calendar data source exposes dashboard snapshot and persistence', async () => {
  const dataSource = createCalendarDataSource({ useStubData: true });

  const initial = await dataSource.fetchDashboard({ role: 'MODEL' });
  assert.ok(Array.isArray(initial.weeklyRules));
  assert.ok(initial.weeklyRules.length >= 1);

  const newRuleId = await dataSource.saveWeeklyRule({
    role: 'MODEL',
    roleCode: 'MODEL',
    weekdayMask: 0b1000001,
    startLocal: '10:00',
    endLocal: '14:00',
    timezone: 'UTC',
    minDurationMin: 45,
    leadTimeHours: 12,
    bookingWindowDays: 10,
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 5,
    active: true
  });

  assert.ok(typeof newRuleId === 'string');

  const updated = await dataSource.fetchDashboard({ role: 'MODEL' });
  assert.ok(updated.weeklyRules.some((rule) => rule.ruleId === newRuleId));

  const exceptionId = await dataSource.saveException({
    role: 'MODEL',
    roleCode: 'MODEL',
    dateLocal: '2025-12-24',
    timezone: 'UTC',
    kind: 'unavailable',
    startLocal: null,
    endLocal: null,
    note: 'Holiday'
  });
  assert.ok(typeof exceptionId === 'string');

  const exceptionsSnapshot = await dataSource.fetchDashboard({ role: 'MODEL' });
  assert.ok(exceptionsSnapshot.exceptions.some((exception) => exception.excId === exceptionId));

  const feedUrl = await dataSource.createIcsFeed({ includeHolds: true, baseUrl: 'https://example.com' });
  assert.ok(feedUrl.startsWith('https://example.com'));

  const calendars = await dataSource.fetchExternalCalendars();
  assert.ok(calendars.feed);
  assert.equal(calendars.feed.includeHolds, true);

  const holdId = await dataSource.createHold({
    role: 'MODEL',
    startUtc: '2025-12-25T15:00:00Z',
    endUtc: '2025-12-25T16:00:00Z',
    source: 'checkout',
    ttlMinutes: 20
  });
  assert.ok(typeof holdId === 'string');

  const holds = await dataSource.fetchHoldSummaries('MODEL');
  assert.ok(holds.some((hold) => hold.holdId === holdId));

  const slots = await dataSource.fetchFeasibleSlots({
    role: 'MODEL',
    dateFrom: '2025-12-20',
    dateTo: '2025-12-27',
    durationMin: 60
  });
  assert.ok(Array.isArray(slots));
});

test('stub calendar client API mirrors data source', async () => {
  const client = createStubCalendarClient({
    defaultRole: 'ARTIST'
  });
  const dashboard = await client.fetchDashboard({ role: 'ARTIST', durationMin: 30 });
  assert.equal(dashboard.metrics.weeklyRuleCount >= 1, true);

  const hold = await client.createHoldAndConfirm({
    hold: {
      role: 'ARTIST',
      startUtc: '2025-10-01T18:00:00Z',
      endUtc: '2025-10-01T19:00:00Z',
      source: 'checkout'
    },
    booking: {
      orderId: 'ord_stub_confirm'
    }
  });

  assert.equal(typeof hold.hold.holdId, 'string');
  assert.equal(hold.confirmation.status, 'confirmed');
});
