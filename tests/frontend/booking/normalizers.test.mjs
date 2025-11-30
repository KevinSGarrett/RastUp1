import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGraphqlBooking } from '../../../tools/frontend/booking/index.mjs';

test('normalizeGraphqlBooking maps GraphQL payload', () => {
  const payload = {
    serviceProfile: {
      id: 'srv_mdl_avery',
      displayName: 'Avery Harper',
      role: 'MODEL',
      location: { city: 'Austin' }
    },
    packages: [
      {
        id: 'pkg-1',
        name: 'Editorial',
        price: 45000,
        duration: 240,
        includes: ['3 looks'],
        addons: [{ id: 'addon-1', name: 'Moodboard', price: 5000 }]
      }
    ],
    availability: [
      { day: '2025-12-01', times: ['10:00', '14:00'] }
    ],
    documents: [{ id: 'doc-1', name: 'SOW', required: true }]
  };

  const normalized = normalizeGraphqlBooking(payload);
  assert.equal(normalized.serviceProfile?.displayName, 'Avery Harper');
  assert.equal(normalized.packages.length, 1);
  assert.equal(normalized.packages[0].addons?.length, 1);
  assert.equal(normalized.availability[0].slots.length, 2);
  assert.equal(normalized.documents[0].name, 'SOW');
});
