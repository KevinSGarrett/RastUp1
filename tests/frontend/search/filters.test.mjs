import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listFiltersForSurface,
  serializeFilters,
  parseFilters,
  applyFilterMetadata,
  describeFilterValue,
  defaultFilters
} from '../../../tools/frontend/search/index.mjs';

test('listFiltersForSurface returns defaults for people', () => {
  const filters = listFiltersForSurface('PEOPLE', 'MODEL');
  const cityFilter = filters.find((filter) => filter.key === 'city');
  const genresFilter = filters.find((filter) => filter.key === 'genres');

  assert.ok(cityFilter, 'city filter included');
  assert.ok(genresFilter, 'role filter included');
  assert.equal(genresFilter.type, 'multi-select');
});

test('listFiltersForSurface returns studio filters', () => {
  const filters = listFiltersForSurface('STUDIOS');
  const amenities = filters.find((filter) => filter.key === 'amenities');
  assert.ok(amenities);
  assert.equal(amenities.type, 'multi-select');
});

test('serializeFilters flattens structures', () => {
  const serialized = serializeFilters({
    city: 'Austin',
    priceRange: { min: 10000, max: 50000 },
    verified: ['ID', 'SOCIAL']
  });

  assert.equal(serialized.city, 'Austin');
  assert.equal(serialized.verified, 'ID,SOCIAL');
  assert.equal(typeof serialized.priceRange, 'string');
});

test('parseFilters hydrates objects', () => {
  const filters = parseFilters({
    city: 'Austin',
    priceRange: '10000:25000',
    verified: 'ID,SOCIAL',
    availability: JSON.stringify({ start: '2025-12-01', end: '2025-12-07' })
  });

  assert.equal(filters.city, 'Austin');
  assert.deepEqual(filters.verified, ['ID', 'SOCIAL']);
  assert.equal(filters.priceRange.min, 10000);
  assert.equal(filters.priceRange.max, 25000);
  assert.equal(filters.availability.start, '2025-12-01');
});

test('applyFilterMetadata enriches selection', () => {
  const descriptors = listFiltersForSurface('PEOPLE', 'MODEL');
  const enriched = applyFilterMetadata(
    {
      priceRange: { min: 10000, max: 20000 },
      instantBook: true,
      genres: ['fashion', 'editorial']
    },
    descriptors
  );

  assert.equal(enriched.priceRange.type, 'range');
  assert.equal(enriched.instantBook.value, true);
  assert.deepEqual(enriched.genres.values, ['fashion', 'editorial']);
});

test('describeFilterValue renders friendly strings', () => {
  assert.equal(describeFilterValue('instantBook', true), 'Yes');
  assert.equal(describeFilterValue('priceRange', { min: 10000, max: 20000 }), '10,000 – 20,000');
  assert.equal(
    describeFilterValue('availability', { start: '2025-12-01', end: '2025-12-07' }),
    '2025-12-01 → 2025-12-07'
  );
});

test('defaultFilters returns safe baseline', () => {
  const defaults = defaultFilters();
  assert.equal(defaults.instantBook, false);
  assert.deepEqual(defaults.verified, []);
  assert.equal(defaults.priceRange, null);
});
