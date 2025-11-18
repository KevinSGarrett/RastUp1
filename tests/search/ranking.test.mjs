import test from 'node:test';
import assert from 'node:assert/strict';
import { rankDocuments, enforceOrganicShare } from '../../services/search/ranking.js';

const baseContext = {
  weights: {
    text: 0.45,
    proximity: 0.2,
    reputation: 0.12,
    verification: 0.1,
    priceFit: 0.08,
    availability: 0.03,
    recency: 0.02
  },
  queryBudgetCents: 20000,
  geoPreference: { origin: { lat: 29.76, lon: -95.36 }, radiusKm: 50 },
  date: '2025-11-12',
  newSellerFloor: { slots: 2, minRatingCount: 5 },
  ownerDiversity: { maxPerOwner: 1, window: 6 },
  allowSafeModeBand: 1,
  nowEpoch: Date.now() / 1000
};

function makeDoc(id, overrides = {}) {
  return {
    id,
    surface: 'PEOPLE',
    ownerId: overrides.ownerId ?? id,
    city: 'Houston',
    country: 'US',
    safeModeBandMax: overrides.safeModeBandMax ?? 1,
    ratingAvg: overrides.ratingAvg ?? 4.6,
    ratingCount: overrides.ratingCount ?? 20,
    priceFromCents: overrides.priceFromCents ?? 18000,
    availabilityScore: overrides.availabilityScore ?? 0.8,
    verifiedId: overrides.verifiedId ?? true,
    policySignals: overrides.policySignals,
    createdAtEpoch: overrides.createdAtEpoch ?? baseContext.nowEpoch - 86400,
    updatedAtEpoch: overrides.updatedAtEpoch ?? baseContext.nowEpoch - 3600,
    newSellerScore: overrides.newSellerScore,
    ownerGroupId: overrides.ownerGroupId
  };
}

test('rankDocuments enforces owner diversity and new-seller floor', () => {
  const docs = [
    makeDoc('doc1', { ownerId: 'ownerA', ratingCount: 30 }),
    makeDoc('doc2', { ownerId: 'ownerA', ratingCount: 25 }),
    makeDoc('doc3', { ownerId: 'ownerB', ratingCount: 10 }),
    makeDoc('doc4', { ownerId: 'ownerC', ratingCount: 2, newSellerScore: 0.9 }),
    makeDoc('doc5', { ownerId: 'ownerD', ratingCount: 1, newSellerScore: 0.8 }),
    makeDoc('doc6', { ownerId: 'ownerE', ratingCount: 50 })
  ];

  const signalMap = {
    doc1: { textMatch: 0.9 },
    doc2: { textMatch: 0.85 },
    doc3: { textMatch: 0.8 },
    doc4: { textMatch: 0.75 },
    doc5: { textMatch: 0.7 },
    doc6: { textMatch: 0.65 }
  };

  const { results, dropped } = rankDocuments(docs, signalMap, baseContext);

  const selectedOwners = results.map((entry) => entry.document.ownerId);
  assert.ok(selectedOwners.length <= baseContext.ownerDiversity.window, 'window constraint enforced');
  const ownerSet = new Set(selectedOwners);
  assert.equal(ownerSet.size, selectedOwners.length, 'owner diversity enforced (max 1 per owner)');

  const newSellerCount = results.filter((entry) => (entry.document.ratingCount ?? 0) < baseContext.newSellerFloor.minRatingCount).length;
  assert.ok(newSellerCount >= baseContext.newSellerFloor.slots, 'new seller floor reserved');

  assert.ok(dropped.some((entry) => entry.document.id === 'doc2'), 'second doc from same owner dropped');
});

test('enforceOrganicShare keeps organic ratio within guardrail', () => {
  assert.equal(enforceOrganicShare(8, 2, 0.8), true);
  assert.equal(enforceOrganicShare(7, 3, 0.8), false);
});
