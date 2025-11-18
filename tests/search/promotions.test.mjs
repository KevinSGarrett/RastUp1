import test from 'node:test';
import assert from 'node:assert/strict';
import { allocatePromotions } from '../../services/search/promotions.js';

const config = {
  featuredSlots: 2,
  featuredMaxAboveFold: 1,
  boostFrequency: 3,
  boostStartPosition: 5,
  maxFeaturedInTopN: 2,
  invalidClickWindowSeconds: 120
};

test('allocatePromotions enforces density caps and invalid-click filtering', () => {
  const now = Math.floor(Date.now() / 1000);
  const candidates = [
    { id: 'feat1', slot: 'FEATURED', orderScore: 1.0, document: {} },
    { id: 'feat2', slot: 'FEATURED', orderScore: 0.9, document: {} },
    { id: 'feat3', slot: 'FEATURED', orderScore: 0.8, document: {} },
    { id: 'boost1', slot: 'BOOST', orderScore: 0.7, document: {} },
    { id: 'boost2', slot: 'BOOST', orderScore: 0.6, document: {} }
  ];

  const invalidClicks = [{ documentId: 'boost1', occurredAt: now - 60 }];

  const result = allocatePromotions(candidates, config, { nowEpoch: now, invalidClicks });

  assert.deepEqual(result.invalidClickFiltered, ['boost1'], 'invalid click candidate filtered');
  assert.ok(result.densityViolations.includes('feat3'), 'excess featured flagged');
  const featuredPlacements = result.placements.filter((p) => p.slot === 'FEATURED');
  assert.ok(featuredPlacements.length <= config.featuredSlots, 'featured slots limited');
  assert.ok(featuredPlacements.filter((p) => p.position <= 5).length <= config.featuredMaxAboveFold, 'above fold cap');
});
