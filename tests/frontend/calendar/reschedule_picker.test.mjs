import test from 'node:test';
import assert from 'node:assert/strict';

import { createReschedulePickerStore } from '../../../tools/frontend/calendar/reschedule_picker.mjs';

const SAMPLE_SLOTS = [
  {
    slotId: 'slot-1',
    startUtc: '2025-04-19T14:00:00.000Z',
    endUtc: '2025-04-19T15:30:00.000Z'
  },
  {
    slotId: 'slot-2',
    startUtc: '2025-04-19T20:00:00.000Z',
    endUtc: '2025-04-19T21:00:00.000Z'
  },
  {
    slotId: 'slot-3',
    startUtc: '2025-04-20T16:00:00.000Z',
    endUtc: '2025-04-20T17:30:00.000Z'
  }
];

test('reschedule picker filtering and selection workflow', () => {
  const store = createReschedulePickerStore({
    durationMin: 60,
    filters: { day: 'ANY', timeOfDay: 'ANY' },
    now: '2025-04-18T12:00:00Z'
  });

  store.loadSlots({ slots: SAMPLE_SLOTS });
  let state = store.getState();
  assert.equal(state.filteredSlots.length, 3);

  store.setFilters({ day: 'WEEKEND', timeOfDay: 'EVENING' });
  state = store.getState();
  assert.equal(state.filteredSlots.length, 1);
  assert.equal(state.filteredSlots[0].slotId, 'slot-2');

  store.setDuration(75);
  state = store.getState();
  assert.equal(state.filteredSlots.length, 0);

  store.setFilters({ timeOfDay: 'ANY' });
  state = store.getState();
  assert.equal(state.filteredSlots.length, 2);
  assert.equal(state.filteredSlots[1].slotId, 'slot-3');

  store.selectSlot('slot-3');
  state = store.getState();
  assert.equal(state.selection.slotId, 'slot-3');
  assert.equal(state.selection.durationMinutes, 90);

  store.recordHoldResult({
    holdId: 'hld_123',
    status: 'active',
    expiresAt: '2025-04-20T15:45:00.000Z'
  });
  state = store.getState();
  assert.equal(state.holdStatus.holdId, 'hld_123');
  assert.equal(state.holdStatus.status, 'active');
});
