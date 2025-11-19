import test from 'node:test';
import assert from 'node:assert/strict';

import { createCalendarController } from '../../../tools/frontend/calendar/controller.mjs';

const SAMPLE_RULE = {
  ruleId: 'wr_123',
  roleCode: 'MODEL',
  weekdayMask: 0b1111100,
  startLocal: '09:00',
  endLocal: '17:00',
  timezone: 'America/Los_Angeles',
  minDurationMin: 60,
  leadTimeHours: 24,
  bookingWindowDays: 45,
  bufferBeforeMinutes: 15,
  bufferAfterMinutes: 15,
  active: true
};

const SAMPLE_EXCEPTION = {
  excId: 'ex_001',
  dateLocal: '2025-01-10',
  timezone: 'America/Los_Angeles',
  kind: 'unavailable'
};

function createHold(overrides = {}) {
  return {
    holdId: `hld_${Math.random().toString(36).slice(2, 8)}`,
    startUtc: '2025-01-12T18:00:00Z',
    endUtc: '2025-01-12T19:00:00Z',
    ttlExpiresAt: '2025-01-12T18:30:00Z',
    source: 'checkout',
    orderId: null,
    ...overrides
  };
}

test('calendar controller hydrates availability and exposes snapshots', () => {
  const controller = createCalendarController();
  const changes = [];
  controller.subscribe((change) => changes.push(change));

  controller.hydrateAvailability({
    weeklyRules: [SAMPLE_RULE],
    exceptions: [SAMPLE_EXCEPTION],
    holds: [createHold({ holdId: 'hld_base' })]
  });

  assert.equal(changes.at(-1)?.type, 'availability/hydrated');

  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.availability.weeklyRules.length, 1);
  assert.equal(snapshot.availability.weeklyRules[0].ruleId, 'wr_123');
  assert.equal(snapshot.availability.exceptions.length, 1);
  assert.equal(snapshot.holds.length, 1);
});

test('calendar controller manages hold lifecycle and reschedule feedback', () => {
  const controller = createCalendarController();
  const hold = createHold({ holdId: 'hld_new', ttlExpiresAt: '2025-01-12T18:30:00Z' });

  controller.applyHoldCreated(hold);
  let snapshot = controller.getSnapshot();
  assert.equal(snapshot.holds.length, 1);
  assert.equal(snapshot.holds[0].holdId, 'hld_new');
  assert.equal(snapshot.reschedule.holdStatus?.holdId, 'hld_new');
  assert.equal(snapshot.reschedule.holdStatus?.status, 'active');

  controller.expireHold('hld_new');
  snapshot = controller.getSnapshot();
  assert.equal(snapshot.reschedule.holdStatus?.status, 'expired');

  controller.applyHoldReleased('hld_new');
  snapshot = controller.getSnapshot();
  assert.equal(snapshot.holds.length, 0);
  assert.equal(snapshot.reschedule.holdStatus, null);
});

test('calendar controller updates feasible slots and external busy entries', () => {
  const controller = createCalendarController();
  const slots = [
    {
      slotId: 'slot-1',
      startUtc: '2025-02-01T10:00:00Z',
      endUtc: '2025-02-01T11:00:00Z',
      confidence: 0.9
    },
    {
      slotId: 'slot-2',
      startUtc: '2025-02-01T12:00:00Z',
      endUtc: '2025-02-01T13:00:00Z',
      confidence: 0.7
    }
  ];
  controller.setFeasibleSlots(slots, { durationMin: 60 });
  let snapshot = controller.getSnapshot();
  assert.equal(snapshot.feasibleSlots.length, 2);
  assert.equal(snapshot.reschedule.filteredSlots.length, 2);

  controller.setExternalBusy([
    {
      extEventId: 'xev_1',
      sourceId: 'cxs_1',
      startUtc: '2025-02-01T09:00:00Z',
      endUtc: '2025-02-01T10:30:00Z',
      busy: true
    }
  ]);

  snapshot = controller.getSnapshot();
  assert.equal(snapshot.externalBusy.length, 1);
  assert.equal(snapshot.externalBusy[0].extEventId, 'xev_1');
});

test('calendar controller records sync and telemetry events', () => {
  const controller = createCalendarController();
  controller.hydrateConnections({
    sources: [
      {
        srcId: 'cxs_1',
        kind: 'ics',
        urlOrRemoteId: 'https://example.com/private.ics',
        status: 'active'
      }
    ]
  });

  controller.recordSyncResult({
    srcId: 'cxs_1',
    status: 'ok',
    fetchedAt: '2025-02-02T12:00:00Z',
    eventCount: 4
  });

  controller.recordTelemetry({ type: 'connect_start', srcId: 'cxs_1' });
  controller.recordConnectError({ srcId: 'cxs_1', message: '503', retriable: true });

  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.connect.orderedSourceIds.length, 1);
  assert.equal(snapshot.connect.telemetry.length > 0, true);
  assert.equal(snapshot.connect.errorLog.length > 0, true);
});
