import test from 'node:test';
import assert from 'node:assert/strict';

import { createSearchStore, SEARCH_STATUS } from '../../../tools/frontend/search/index.mjs';

test('createSearchStore returns default state', () => {
  const store = createSearchStore();
  const state = store.getState();

  assert.equal(state.surface, 'PEOPLE');
  assert.equal(state.query, '');
  assert.equal(state.safeMode, true);
  assert.equal(state.sort, 'RELEVANCE');
  assert.equal(state.status, SEARCH_STATUS.IDLE);
  assert.deepEqual(state.results, []);
  assert.deepEqual(state.filters, {});
  assert.deepEqual(state.facets, {});
  assert.equal(state.stats.total, 0);
});

test('setQuery trims and records interaction', () => {
  const store = createSearchStore();
  store.setQuery('  fashion ');
  const state = store.getState();

  assert.equal(state.query, 'fashion');
  assert.equal(state.pageInfo.page, 1);
  assert.equal(state.telemetry.events.at(-1)?.name, 'search:query_change');
});

test('setSurface resets filters and results paging', () => {
  const store = createSearchStore({ filters: { city: 'Austin' } });

  store.setSurface('STUDIOS');
  const state = store.getState();

  assert.equal(state.surface, 'STUDIOS');
  assert.deepEqual(state.filters, {});
  assert.equal(state.pageInfo.page, 1);
  assert.equal(state.telemetry.events.at(-1)?.name, 'search:surface_change');
});

test('setFilter updates filters and resets cursor', () => {
  const store = createSearchStore();

  store.setFilter('city', 'Houston');
  let state = store.getState();
  assert.equal(state.filters.city, 'Houston');

  store.setFilter('city', null);
  state = store.getState();
  assert.equal(state.filters.city, undefined);
});

test('applyResponse hydrates results and facets', () => {
  const store = createSearchStore();
  const payload = {
    surface: 'PEOPLE',
    results: [
      {
        id: 'srv_mdl_123',
        displayName: 'Avery Harper',
        city: 'Austin',
        safeModeBand: 0,
        ratingAvg: 4.9,
        ratingCount: 27,
        priceFrom: 25000
      }
    ],
    facets: {
      city: {
        label: 'City',
        options: [{ value: 'Austin', label: 'Austin', count: 12, selected: false }]
      }
    },
    stats: { total: 1, latencyMs: 42 },
    pageInfo: { cursor: 'cursor-1', hasNext: false, page: 1 }
  };

  store.applyResponse(payload);
  const state = store.getState();

  assert.equal(state.status, SEARCH_STATUS.READY);
  assert.equal(state.error, null);
  assert.equal(state.results.length, 1);
  assert.equal(state.results[0].displayName, 'Avery Harper');
  assert.equal(state.facets.city.label, 'City');
  assert.equal(state.stats.total, 1);
  assert.equal(state.pageInfo.cursor, 'cursor-1');
  assert.equal(state.telemetry.events.at(-1)?.name, 'search:results_hydrated');
});

test('setSafeMode toggles flag and records telemetry', () => {
  const store = createSearchStore({ safeMode: true });
  store.setSafeMode(false);
  const state = store.getState();

  assert.equal(state.safeMode, false);
  assert.equal(state.telemetry.events.at(-1)?.name, 'search:safe_mode_toggle');
});

test('setError records safe message and status', () => {
  const store = createSearchStore();
  store.setError(new Error('SAFE_CODE'));
  const state = store.getState();

  assert.equal(state.status, SEARCH_STATUS.ERROR);
  assert.equal(state.error, 'SAFE_CODE');
  assert.equal(state.telemetry.events.at(-1)?.name, 'search:error');

  store.setError(null);
  const cleared = store.getState();
  assert.equal(cleared.status, SEARCH_STATUS.READY);
  assert.equal(cleared.error, null);
});

test('subscribe receives snapshots on change', () => {
  const store = createSearchStore();
  let callCount = 0;
  const unsubscribe = store.subscribe((snapshot) => {
    callCount += 1;
    assert.ok(snapshot);
  });

  store.setQuery('portrait');
  store.setSafeMode(false);

  assert.equal(callCount, 2);
  unsubscribe();
  store.setQuery('fashion');
  assert.equal(callCount, 2);
});
