import test from 'node:test';
import assert from 'node:assert/strict';

import { createProfileStore, PROFILE_STATUS } from '../../../tools/frontend/profiles/index.mjs';

const SAMPLE_PROFILE = {
  profile: {
    id: 'srv_mdl_001',
    handle: 'avery',
    displayName: 'Avery Harper',
    headline: 'Fashion & editorial model',
    bio: 'Fashion model based in Austin.',
    location: { city: 'Austin', region: 'TX', country: 'US' },
    languages: ['English', 'Spanish'],
    tags: ['fashion', 'editorial'],
    stats: { ratingAvg: 4.9, ratingCount: 42 }
  },
  roles: ['MODEL', 'PHOTOGRAPHER'],
  activeRole: 'MODEL',
  gallery: [
    { url: 'https://images.stub/avery-1.jpg', alt: 'Editorial shot', nsfwBand: 0 },
    { url: 'https://images.stub/avery-2.jpg', alt: 'Runway', nsfwBand: 0 }
  ],
  packages: [
    {
      packageId: 'pkg-1',
      name: 'Editorial Shoot',
      priceCents: 25000,
      includes: ['10 edited images'],
      addons: [{ name: 'Additional look', priceCents: 5000 }]
    }
  ],
  completeness: 92,
  safeModeBand: 0
};

test('createProfileStore hydrates initial payload', () => {
  const store = createProfileStore(SAMPLE_PROFILE);
  const state = store.getState();

  assert.equal(state.status, PROFILE_STATUS.READY);
  assert.equal(state.profile?.displayName, 'Avery Harper');
  assert.equal(state.roles.length, 2);
  assert.equal(state.activeRole, 'MODEL');
  assert.equal(state.completeness, 92);
});

test('setActiveRole switches roles and records telemetry', () => {
  const store = createProfileStore(SAMPLE_PROFILE);
  store.setActiveRole('PHOTOGRAPHER');
  const state = store.getState();

  assert.equal(state.activeRole, 'PHOTOGRAPHER');
  assert.equal(state.telemetry.events.at(-1)?.name, 'profile:role_change');
});

test('setSafeMode toggles safe-mode flag', () => {
  const store = createProfileStore({ ...SAMPLE_PROFILE, safeModeEnabled: true });
  store.setSafeMode(false);
  let state = store.getState();
  assert.equal(state.safeModeEnabled, false);

  store.setSafeMode();
  state = store.getState();
  assert.equal(state.safeModeEnabled, true);
});

test('hydrate updates profile payload', () => {
  const store = createProfileStore();
  store.hydrate(SAMPLE_PROFILE);
  const state = store.getState();

  assert.equal(state.status, PROFILE_STATUS.READY);
  assert.equal(state.profile?.handle, 'avery');
});

test('setError transitions to error state', () => {
  const store = createProfileStore();
  store.setError(new Error('not_found'));
  let state = store.getState();
  assert.equal(state.status, PROFILE_STATUS.ERROR);
  assert.equal(state.error, 'not_found');

  store.setError(null);
  state = store.getState();
  assert.equal(state.status, PROFILE_STATUS.READY);
  assert.equal(state.error, null);
});
