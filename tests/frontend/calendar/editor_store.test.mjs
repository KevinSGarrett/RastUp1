import test from 'node:test';
import assert from 'node:assert/strict';

import { createAvailabilityEditorStore } from '../../../tools/frontend/calendar/editor_store.mjs';

test('availability editor store recomputes preview and tracks dirty entries', () => {
  const store = createAvailabilityEditorStore({
    weeklyRules: [
      {
        ruleId: 'wr_1',
        userId: 'usr_1',
        roleCode: 'photographer',
        weekdayMask: 1 << 0, // Monday
        startLocal: '09:00',
        endLocal: '11:00',
        timezone: 'America/New_York',
        minDurationMin: 60,
        leadTimeHours: 0,
        bookingWindowDays: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        active: true
      }
    ],
    previewRange: { dateFrom: '2025-03-04', dateTo: '2025-03-04' },
    previewNow: '2025-03-01T00:00:00Z'
  });

  const initial = store.getState();
  assert.equal(initial.previewSlots.length, 2);
  assert.equal(initial.previewSlots[0].startUtc, '2025-03-04T14:00:00Z');
  assert.deepEqual(initial.dirtyWeeklyRuleIds, []);

  const updates = [];
  const unsubscribe = store.subscribe((state) => {
    updates.push(state.previewSlots.length);
  });

  store.setWeeklyRule({
    ruleId: 'wr_1',
    startLocal: '10:00',
    endLocal: '12:00'
  });
  assert.ok(store.getState().dirtyWeeklyRuleIds.includes('wr_1'));

  const afterRuleChange = store.recomputePreview();
  assert.equal(afterRuleChange.previewSlots[0].startUtc, '2025-03-04T15:00:00Z');

  store.upsertException({
    excId: 'ex_lunch',
    userId: 'usr_1',
    dateLocal: '2025-03-04',
    timezone: 'America/New_York',
    kind: 'unavailable',
    startLocal: '11:00',
    endLocal: '12:00'
  });
  const afterException = store.recomputePreview();
  assert.equal(afterException.previewSlots.length, 1);
  assert.ok(afterException.dirtyExceptionIds.includes('ex_lunch'));

  store.markClean();
  const cleanState = store.getState();
  assert.deepEqual(cleanState.dirtyWeeklyRuleIds, []);
  assert.deepEqual(cleanState.dirtyExceptionIds, []);

  unsubscribe();
  assert.ok(updates.length >= 2);
});
