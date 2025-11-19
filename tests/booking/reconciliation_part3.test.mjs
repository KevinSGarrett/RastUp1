import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeVarianceSummary,
  evaluateCloseReadiness,
  createCloseSnapshot,
  ReconciliationError
} from '../../services/booking/reconciliation.js';

test('computeVarianceSummary returns expected and variance figures', () => {
  const summary = computeVarianceSummary({
    chargeCapturedCents: 150000,
    refundTotalCents: 20000,
    payoutTotalCents: 110000,
    reserveHeldCents: 10000,
    adjustmentsCents: 5000
  });
  assert.equal(summary.expected, 135000);
  assert.equal(summary.actual, 120000);
  assert.equal(summary.variance, 15000);
  assert.ok(summary.varianceBps > 0);
});

test('evaluateCloseReadiness respects tolerance and outstanding items', () => {
  const summary = computeVarianceSummary({
    chargeCapturedCents: 100000,
    refundTotalCents: 10000,
    payoutTotalCents: 85000,
    reserveHeldCents: 5000
  });
  const ready = evaluateCloseReadiness({ varianceSummary: summary, toleranceBps: 300 });
  assert.equal(ready.ready, true);

  const notReady = evaluateCloseReadiness({
    varianceSummary: { variance: 1, varianceBps: 400 },
    outstandingItems: []
  });
  assert.equal(notReady.ready, false);
});

test('createCloseSnapshot materialises items with identifiers', () => {
  const summary = computeVarianceSummary({
    chargeCapturedCents: 50000,
    refundTotalCents: 5000,
    payoutTotalCents: 40000,
    reserveHeldCents: 2000
  });
  const snapshot = createCloseSnapshot({
    closeDate: '2025-11-19',
    actorAdmin: 'admin_1',
    varianceSummary: summary,
    items: [{ category: 'payouts', expectedCents: 43000, actualCents: 42000, varianceCents: 1000 }]
  });
  assert.equal(snapshot.closeDate, '2025-11-19');
  assert.equal(snapshot.items.length, 1);
  assert.equal(typeof snapshot.items[0].itemId, 'string');
});

test('evaluateCloseReadiness throws when variance summary missing', () => {
  assert.throws(
    () => evaluateCloseReadiness({ varianceSummary: null }),
    (error) => error instanceof ReconciliationError
  );
});
