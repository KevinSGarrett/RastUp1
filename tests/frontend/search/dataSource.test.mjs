import test from 'node:test';
import assert from 'node:assert/strict';

import { createSearchDataSource } from '../../../web/lib/search/dataSource.mjs';

test('createSearchDataSource returns stub results', async () => {
  const dataSource = createSearchDataSource();
  const payload = await dataSource.search({
    surface: 'PEOPLE',
    query: '',
    filters: {},
    safeMode: true
  });

  assert.equal(payload.surface, 'PEOPLE');
  assert.equal(Array.isArray(payload.results), true);
  assert.ok(payload.results.length > 0, 'stub data returns results');
  assert.equal(payload.results[0].surface, 'PEOPLE');
});

test('safe mode filters explicit results', async () => {
  const dataSource = createSearchDataSource();
  const safePayload = await dataSource.search({
    surface: 'PEOPLE',
    query: '',
    filters: {},
    safeMode: true
  });
  const unsafePayload = await dataSource.search({
    surface: 'PEOPLE',
    query: '',
    filters: {},
    safeMode: false
  });

  assert.ok(unsafePayload.results.length >= safePayload.results.length);
});

test('suggest returns fallback suggestions', async () => {
  const dataSource = createSearchDataSource();
  const suggestions = await dataSource.suggest({
    surface: 'PEOPLE',
    query: 'fashion'
  });

  assert.ok(Array.isArray(suggestions));
  assert.ok(suggestions.length > 0);
  assert.equal(typeof suggestions[0].query, 'string');
});
