import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSearchInput,
  buildCacheKey,
  serializeFiltersForCache,
  canOverrideSafeMode
} from '../../services/search/query.js';

test('normalizeSearchInput enforces safe-mode and role filter gating', () => {
  const input = {
    surface: 'PEOPLE',
    city: ' Houston ',
    role: 'MODEL',
    safeMode: false,
    verifiedOnly: true,
    model: { genres: ['fashion'] },
    photographer: { specialties: ['portrait'] }
  };

  const result = normalizeSearchInput(input, { allowSafeModeOverride: false, safeModeFloor: 1 });

  assert.ok(result.errors.includes('SEARCH_UNDERAGE_SAFEMODE'), 'underage safe-mode override blocked');
  assert.ok(result.errors.some((err) => err.startsWith('SEARCH_ROLE_FILTER_CONFLICT')), 'role mismatch flagged');
  assert.match(result.filterExpression, /safeModeBandMax:<=1/, 'safe-mode filter applied');
  assert.match(result.filterExpression, /city:="Houston"/, 'city normalized and applied');
});

test('buildCacheKey produces stable digest for identical filters', () => {
  const filtersA = serializeFiltersForCache({ city: 'Houston', role: 'MODEL', safeModeBandMax: 1 });
  const filtersB = serializeFiltersForCache({ role: 'MODEL', safeModeBandMax: 1, city: 'Houston' });

  const keyA = buildCacheKey({
    surface: 'PEOPLE',
    city: 'Houston',
    role: 'MODEL',
    safeMode: true,
    normalizedFilters: filtersA,
    version: 'v1'
  });

  const keyB = buildCacheKey({
    surface: 'PEOPLE',
    city: 'Houston',
    role: 'MODEL',
    safeMode: true,
    normalizedFilters: filtersB,
    version: 'v1'
  });

  assert.equal(keyA, keyB, 'stable cache key for identical filters');
});

test('canOverrideSafeMode respects role and verification', () => {
  assert.equal(
    canOverrideSafeMode({ surface: 'PEOPLE', role: 'FANSUB', safeMode: false, userIsVerifiedAdult: false }),
    false,
    'fansub requires verified adult'
  );
  assert.equal(
    canOverrideSafeMode({ surface: 'STUDIOS', safeMode: false }),
    true,
    'studios can disable safe-mode'
  );
});
