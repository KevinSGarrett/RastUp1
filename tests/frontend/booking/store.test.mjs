import test from 'node:test';
import assert from 'node:assert/strict';

import { createBookingStore, BOOKING_STATUS } from '../../../tools/frontend/booking/index.mjs';

const SAMPLE_BOOKING = {
  serviceProfile: {
    id: 'srv_mdl_avery',
    displayName: 'Avery Harper',
    role: 'MODEL'
  },
  packages: [
    {
      packageId: 'pkg-1',
      name: 'Editorial Half Day',
      priceCents: 45000,
      durationMinutes: 240,
      includes: ['3 looks'],
      addons: [{ addonId: 'addon-moodboard', name: 'Moodboard', priceCents: 5000 }]
    },
    {
      packageId: 'pkg-2',
      name: 'Runway Event',
      priceCents: 30000,
      durationMinutes: 180
    }
  ],
  availability: [
    { date: '2025-12-01', slots: ['10:00', '14:00'] },
    { date: '2025-12-03', slots: ['09:00', '13:00'] }
  ],
  documents: [{ documentId: 'doc-sow', name: 'Statement of Work', required: true }]
};

test('createBookingStore hydrates payload and computes pricing', () => {
  const store = createBookingStore(SAMPLE_BOOKING);
  const state = store.getState();

  assert.equal(state.status, BOOKING_STATUS.READY);
  assert.equal(state.serviceProfile?.displayName, 'Avery Harper');
  assert.ok(state.packages.length > 0);
  assert.ok(state.price.total > 0);
});

test('setPackage updates selection and recalculates totals', () => {
  const store = createBookingStore(SAMPLE_BOOKING);
  store.setPackage('pkg-2');
  const state = store.getState();

  assert.equal(state.selectedPackageId, 'pkg-2');
  assert.ok(state.price.total > 0);
});

test('toggleAddon toggles add-on pricing', () => {
  const store = createBookingStore(SAMPLE_BOOKING);
  store.setPackage('pkg-1');
  const priceBefore = store.getState().price.total;

  store.toggleAddon('addon-moodboard');
  const priceAfter = store.getState().price.total;
  assert.ok(priceAfter > priceBefore);

  store.toggleAddon('addon-moodboard');
  const priceReset = store.getState().price.total;
  assert.equal(priceReset, priceBefore);
});

test('selectSlot stores selection and logs telemetry', () => {
  const store = createBookingStore(SAMPLE_BOOKING);
  store.selectSlot('2025-12-01', '10:00');
  const state = store.getState();

  assert.deepEqual(state.selectedSlot, { date: '2025-12-01', slot: '10:00' });
  assert.equal(state.telemetry.events.at(-1)?.name, 'booking:slot_selected');
});

test('setError transitions to error state', () => {
  const store = createBookingStore(SAMPLE_BOOKING);
  store.setError(new Error('payment_failed'));
  let state = store.getState();
  assert.equal(state.status, BOOKING_STATUS.ERROR);
  assert.equal(state.error, 'payment_failed');

  store.setError(null);
  state = store.getState();
  assert.equal(state.status, BOOKING_STATUS.READY);
  assert.equal(state.error, null);
});
