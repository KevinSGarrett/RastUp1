import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeGraphqlSearchPayload,
  normalizeAutocompletePayload
} from '../../../tools/frontend/search/index.mjs';

test('normalizeGraphqlSearchPayload converts GraphQL shape', () => {
  const payload = {
    surface: 'PEOPLE',
    results: {
      edges: [
        {
          node: {
            id: 'srv_mdl_001',
            displayName: 'Riley Park',
            location: { city: 'Seattle', region: 'WA', country: 'US' },
            role: 'MODEL',
            heroImage: { url: 'https://cdn.example.com/riley.jpg', alt: 'Riley' },
            safeMode: { band: 1, override: false },
            reviewStats: { ratingAvg: 4.8, ratingCount: 42 },
            price: { fromCents: 18000, toCents: 36000 },
            instantBook: true,
            verifications: { id: true, background: true, social: false },
            tags: ['fashion', 'editorial'],
            media: [{ url: 'https://cdn.example.com/riley-1.jpg', nsfwBand: 0 }]
          }
        }
      ],
      pageInfo: { endCursor: 'cur-123', hasNextPage: true }
    },
    facets: {
      city: {
        label: 'City',
        options: [{ value: 'Seattle', count: 9, selected: false }]
      }
    },
    stats: { total: 24, latencyMs: 38 }
  };

  const normalized = normalizeGraphqlSearchPayload(payload);
  assert.equal(normalized.results.length, 1);
  const result = normalized.results[0];
  assert.equal(result.displayName, 'Riley Park');
  assert.equal(result.city, 'Seattle');
  assert.equal(result.safeModeBand, 1);
  assert.equal(result.ratingAvg, 4.8);
  assert.equal(result.priceFrom, 18000);
  assert.equal(result.instantBook, true);
  assert.equal(result.verified.id, true);
  assert.equal(normalized.pageInfo.cursor, 'cur-123');
  assert.equal(normalized.pageInfo.hasNext, true);
  assert.equal(normalized.stats.total, 24);
});

test('normalizeAutocompletePayload handles mixed shapes', () => {
  const normalized = normalizeAutocompletePayload({
    suggestions: [
      'fashion photographer',
      { query: 'portrait studio', kind: 'query' },
      { label: 'Austin, TX', type: 'city', metadata: { city: 'Austin' } }
    ]
  });

  assert.equal(normalized.length, 3);
  assert.equal(normalized[0].query, 'fashion photographer');
  assert.equal(normalized[1].query, 'portrait studio');
  assert.equal(normalized[2].kind, 'city');
  assert.equal(normalized[2].metadata.city, 'Austin');
});
