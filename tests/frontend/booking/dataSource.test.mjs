import test from 'node:test';
import assert from 'node:assert/strict';

import { createBookingDataSource } from '../../../web/lib/booking/dataSource.mjs';

test('createBookingDataSource returns stub booking data', async () => {
  const dataSource = createBookingDataSource();
  const payload = await dataSource.fetchBooking({ serviceProfileId: 'srv_mdl_avery' });

  assert.equal(payload.serviceProfile?.displayName, 'Avery Harper');
  assert.ok(payload.packages.length > 0);
  assert.ok(payload.availability.length > 0);
});
