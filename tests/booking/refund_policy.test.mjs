import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateRefundOutcome, PolicyInvariantError } from '../../services/booking/policy.js';

const LEG = Object.freeze({
  legId: 'leg_talent_1',
  startAt: '2025-12-10T18:00:00Z',
  totalCents: 100000,
  taxCents: 8000
});

const POLICY = Object.freeze({
  version: 3,
  providerCancelFullRefund: true,
  bands: [
    { fromHours: 72, buyerRefundPct: 100, sellerPayoutPct: 0 },
    { fromHours: 24, toHours: 72, buyerRefundPct: 50, sellerPayoutPct: 50 },
    { fromHours: 0, toHours: 24, buyerRefundPct: 0, sellerPayoutPct: 100 }
  ]
});

test('calculateRefundOutcome returns full refund when provider cancels', () => {
  const outcome = calculateRefundOutcome({
    leg: LEG,
    policy: POLICY,
    context: {
      cancelAt: '2025-12-05T18:00:00Z',
      providerCancelled: true,
      taxBehavior: 'FULL'
    }
  });

  assert.equal(outcome.refundCents, 100000);
  assert.equal(outcome.sellerRetainedCents, 0);
  assert.equal(outcome.taxRefundCents, 8000);
  assert.equal(outcome.overrideApplied, false);
  assert.equal(outcome.policyVersion, 3);
});

test('calculateRefundOutcome respects time-banded policy', () => {
  const cancelAt = '2025-12-10T06:00:00Z'; // 12 hours prior => zero refund band
  const outcome = calculateRefundOutcome({
    leg: LEG,
    policy: POLICY,
    context: {
      cancelAt,
      taxBehavior: 'PARTIAL'
    }
  });

  assert.equal(outcome.refundCents, 0);
  assert.equal(outcome.sellerRetainedCents, 100000);
  assert.equal(outcome.taxRefundCents, 0);
});

test('calculateRefundOutcome applies admin override when provided', () => {
  const outcome = calculateRefundOutcome({
    leg: LEG,
    policy: POLICY,
    context: {
      cancelAt: '2025-12-09T18:00:00Z',
      override: {
        refundCents: 25000,
        taxRefundCents: 2000
      }
    }
  });

  assert.equal(outcome.refundCents, 25000);
  assert.equal(outcome.taxRefundCents, 2000);
  assert.equal(outcome.overrideApplied, true);
});

test('calculateRefundOutcome rejects missing cancellation timestamp', () => {
  assert.throws(
    () => calculateRefundOutcome({ leg: LEG, policy: POLICY, context: {} }),
    (error) => error instanceof PolicyInvariantError && error.code === 'CANCEL_TS_REQUIRED'
  );
});
