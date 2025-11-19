import test from 'node:test';
import assert from 'node:assert/strict';

import {
  quoteLegCancellation,
  buildRefundCommand,
  summarizeRefundOutcomes,
  derivePartialCancellationGuidance,
  CancellationExecutionError
} from '../../services/booking/cancellations.js';

const POLICY = Object.freeze({
  version: 2,
  bands: [
    { fromHours: 72, buyerRefundPct: 100, sellerPayoutPct: 0 },
    { fromHours: 24, toHours: 72, buyerRefundPct: 50, sellerPayoutPct: 50 },
    { fromHours: 0, toHours: 24, buyerRefundPct: 0, sellerPayoutPct: 100 }
  ]
});

const LEG = Object.freeze({
  legId: 'leg_cancel',
  status: 'CONFIRMED',
  startAt: '2025-12-10T18:00:00Z',
  totalCents: 100000,
  taxCents: 8000,
  policy: POLICY
});

test('quoteLegCancellation computes refund outcome using policy bands', () => {
  const outcome = quoteLegCancellation({
    leg: LEG,
    cancelAt: '2025-12-09T06:00:00Z'
  });

  assert.equal(outcome.refundCents, 50000);
  assert.equal(outcome.sellerRetainedCents, 50000);
  assert.equal(outcome.taxRefundCents > 0, true);
});

test('buildRefundCommand validates outcome and produces metadata', () => {
  const outcome = { refundCents: 25000, taxRefundCents: 2000, sellerRetainedCents: 75000, policyVersion: 2, overrideApplied: false };
  const command = buildRefundCommand({
    lbgId: 'lbg_cancel',
    legId: 'leg_cancel',
    outcome,
    reason: 'buyer_cancelled',
    idempotencyKey: 'refund-leg-cancel-1'
  });

  assert.equal(command.amountCents, 25000);
  assert.equal(command.taxRefundCents, 2000);
  assert.equal(command.metadata.overrideApplied, false);
});

test('summarizeRefundOutcomes aggregates across legs', () => {
  const summary = summarizeRefundOutcomes([
    { legId: 'leg_a', refundCents: 20000, sellerRetainedCents: 80000, taxRefundCents: 1500 },
    { legId: 'leg_b', refundCents: 10000, sellerRetainedCents: 90000, taxRefundCents: 500 }
  ]);

  assert.equal(summary.totalRefundCents, 30000);
  assert.equal(summary.totalTaxRefundCents, 2000);
  assert.equal(summary.legs.length, 2);
});

test('derivePartialCancellationGuidance identifies remaining active legs', () => {
  const { survivingLegs, groupStatus } = derivePartialCancellationGuidance({
    legs: [
      { legId: 'leg_a', status: 'CONFIRMED' },
      { legId: 'leg_b', status: 'CONFIRMED' }
    ],
    cancelledLegId: 'leg_a'
  });

  assert.equal(survivingLegs.length, 1);
  assert.equal(groupStatus, 'PARTIAL_ACTIVE');
});

test('quoteLegCancellation guards invalid status', () => {
  assert.throws(
    () =>
      quoteLegCancellation({
        leg: { ...LEG, status: 'COMPLETED' },
        cancelAt: '2025-12-07T18:00:00Z'
      }),
    (error) => error instanceof CancellationExecutionError && error.code === 'LEG_STATUS_NOT_CANCELLABLE'
  );
});
