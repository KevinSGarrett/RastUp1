import test from 'node:test';
import assert from 'node:assert/strict';

import { createProfileDataSource } from '../../../web/lib/profiles/dataSource.mjs';

test('createProfileDataSource returns stub profile', async () => {
  const dataSource = createProfileDataSource();
  const payload = await dataSource.fetchProfile({
    handle: 'avery-harper',
    role: 'MODEL',
    safeMode: true
  });

  assert.equal(payload.profile.displayName, 'Avery Harper');
  assert.equal(payload.roles.includes('MODEL'), true);
  assert.equal(payload.activeRole, 'MODEL');
  assert.ok(Array.isArray(payload.packages));
});

test('safe mode filters sensitive media', async () => {
  const dataSource = createProfileDataSource();
  const safePayload = await dataSource.fetchProfile({
    handle: 'avery-harper',
    safeMode: true
  });
  const unsafePayload = await dataSource.fetchProfile({
    handle: 'avery-harper',
    safeMode: false
  });

  assert.ok(unsafePayload.gallery.length >= safePayload.gallery.length);
});
