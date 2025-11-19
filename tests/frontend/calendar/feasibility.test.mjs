import test from 'node:test';
import assert from 'node:assert/strict';

import { computeFeasibleSlots } from '../../../services/calendar/feasibility.js';

function buildWeekdayMask(days) {
  return days.reduce((mask, day) => mask | (1 << day), 0);
}

const MONDAY = 0;
const TUESDAY = 1;
const WEDNESDAY = 2;
const THURSDAY = 3;
const FRIDAY = 4;
const SATURDAY = 5;
const SUNDAY = 6;

test('computes feasible slots across DST spring forward', () => {
  const weeklyRules = [
    {
      ruleId: 'wr_primary',
      userId: 'usr_1',
      roleCode: 'photographer',
      weekdayMask: buildWeekdayMask([MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY]),
      startLocal: '09:00',
      endLocal: '17:00',
      timezone: 'America/New_York',
      minDurationMin: 60,
      leadTimeHours: 24,
      bookingWindowDays: 30,
      bufferBeforeMin: 15,
      bufferAfterMin: 15,
      active: true
    }
  ];

  const result = computeFeasibleSlots({
    weeklyRules,
    windowStartUtc: '2025-03-11T00:00:00Z',
    windowEndUtc: '2025-03-12T00:00:00Z',
    nowUtc: '2025-03-08T12:00:00Z',
    durationMin: 60
  });

  assert.equal(result.slots.length, 1);
  assert.equal(result.slots[0].startUtc, '2025-03-11T13:15:00.000Z');
  assert.equal(result.slots[0].endUtc, '2025-03-11T20:45:00.000Z');
  assert.equal(result.slots[0].sourceRuleId, 'wr_primary');
});

test('applies exceptions and holds when computing feasibility', () => {
  const weeklyRules = [
    {
      ruleId: 'wr_weekday',
      userId: 'usr_1',
      roleCode: 'photographer',
      weekdayMask: buildWeekdayMask([MONDAY]),
      startLocal: '08:00',
      endLocal: '18:00',
      timezone: 'America/Los_Angeles',
      minDurationMin: 90,
      leadTimeHours: 12,
      bookingWindowDays: 7,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      active: true
    }
  ];
  const exceptions = [
    {
      excId: 'ex_lunch',
      userId: 'usr_1',
      roleCode: 'photographer',
      dateLocal: '2025-05-21',
      timezone: 'America/Los_Angeles',
      kind: 'unavailable',
      startLocal: '12:00',
      endLocal: '13:00'
    },
    {
      excId: 'ex_bonus_day',
      userId: 'usr_1',
      roleCode: 'photographer',
      dateLocal: '2025-05-22',
      timezone: 'America/Los_Angeles',
      kind: 'available',
      startLocal: '10:00',
      endLocal: '14:00'
    }
  ];
  const holds = [
    {
      holdId: 'hld_active',
      userId: 'usr_1',
      roleCode: 'photographer',
      startUtc: '2025-05-21T16:00:00Z',
      endUtc: '2025-05-21T17:00:00Z',
      source: 'checkout',
      ttlExpiresAt: '2025-05-21T18:00:00Z'
    }
  ];
  const confirmedEvents = [
    {
      eventId: 'cev_confirmed',
      userId: 'usr_1',
      roleCode: 'photographer',
      orderId: 'ord_1',
      startUtc: '2025-05-21T18:00:00Z',
      endUtc: '2025-05-21T19:30:00Z',
      status: 'confirmed'
    }
  ];
  const externalBusy = [
    {
      extEventId: 'xev_busy',
      srcId: 'cxs_1',
      userId: 'usr_1',
      startUtc: '2025-05-21T15:00:00Z',
      endUtc: '2025-05-21T15:30:00Z',
      busy: true
    }
  ];

  const result = computeFeasibleSlots({
    weeklyRules,
    exceptions,
    holds,
    confirmedEvents,
    externalBusy,
    windowStartUtc: '2025-05-21T00:00:00Z',
    windowEndUtc: '2025-05-23T00:00:00Z',
    nowUtc: '2025-05-20T16:00:00Z',
    durationMin: 90
  });

  assert.equal(result.slots.length, 1);
  assert.equal(result.slots[0].startUtc, '2025-05-22T17:00:00.000Z');
  assert.equal(result.slots[0].endUtc, '2025-05-22T21:00:00.000Z');
  assert.equal(result.metadata.totalCandidateWindows, 1);
});

test('enforces lead time, booking window, and duration minimums', () => {
  const weeklyRules = [
    {
      ruleId: 'wr_short',
      userId: 'usr_1',
      roleCode: 'photographer',
      weekdayMask: buildWeekdayMask([TUESDAY]),
      startLocal: '09:00',
      endLocal: '10:00',
      timezone: 'UTC',
      minDurationMin: 45,
      leadTimeHours: 6,
      bookingWindowDays: 1,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      active: true
    }
  ];

  const result = computeFeasibleSlots({
    weeklyRules,
    windowStartUtc: '2025-06-17T00:00:00Z',
    windowEndUtc: '2025-06-18T00:00:00Z',
    nowUtc: '2025-06-16T06:00:00Z',
    durationMin: 30
  });

  assert.equal(result.slots.length, 0);
  assert.equal(result.metadata.removedByBookingWindow, 1);
});
