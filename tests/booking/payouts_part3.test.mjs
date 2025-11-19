import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSellerBreakdown,
  computeReservePlan,
  computePayout,
  createPayoutInstruction,
  buildReserveLedgerEntry,
  evaluateReserveRelease,
  PayoutComputationError
} from '../../services/booking/payouts.js';

test('computeSellerBreakdown handles fees, refunds, and adjustments', () => {
  const breakdown = computeSellerBreakdown({
    totalCents: 100000,
    platformFeesCents: 5000,
    refundCents: 10000,
    adjustmentsCents: 2000,
    chargebackReserveCents: 3000
  });
  assert.equal(breakdown.sellerGross, 87000);
  assert.equal(breakdown.sellerNet, 84000);
});

test('computeReservePlan applies policy minimums and percent', () => {
  const plan = computeReservePlan({
    sellerNet: 50000,
    reservePolicy: { reserveBps: 1000, minimumCents: 7000, rollingDays: 7 }
  });
  assert.equal(plan.reserveHoldCents, 7000);
  assert.equal(plan.transferNowCents, 43000);
  assert.ok(plan.reserveReleaseAt);
});

test('computePayout marks instant eligibility when reserve is zero', () => {
  const result = computePayout({
    legId: 'leg_1',
    sellerUserId: 'usr_1',
    totalCents: 40000,
    platformFeesCents: 2000,
    reservePolicy: { reserveBps: 0, minimumCents: 0, rollingDays: 0, instantPayoutEnabled: true },
    supportsInstantPayout: true,
    instantPayoutRequested: true,
    nowIso: '2025-11-19T00:00:00Z',
    payoutDelayDays: 2
  });
  assert.equal(result.reserveHoldCents, 0);
  assert.equal(result.payoutAmountCents, 38000);
  assert.equal(result.instantPayoutEligible, true);
  assert.equal(result.instantFeeCents, 380);
  assert.equal(result.payoutScheduledFor, '2025-11-19T00:00:00.000Z');
});

test('createPayoutInstruction copies metadata and idempotency', () => {
  const instruction = createPayoutInstruction(
    {
      legId: 'leg_2',
      sellerUserId: 'usr_2',
      totalCents: 60000,
      platformFeesCents: 4000,
      reservePolicy: { reserveBps: 500, minimumCents: 0, rollingDays: 5, instantPayoutEnabled: false },
      nowIso: '2025-11-19T00:00:00Z'
    },
    { payoutId: 'pay_123', idempotencyKey: 'custom-key' }
  );
  assert.equal(instruction.payoutId, 'pay_123');
  assert.equal(instruction.idempotencyKey, 'custom-key');
  assert.equal(instruction.metadata.platform_fees_cents, 4000);
  assert.ok(instruction.metadata.reserve_release_at);
});

test('buildReserveLedgerEntry returns null for zero reserves', () => {
  const entry = buildReserveLedgerEntry({ reserveHoldCents: 0, sellerUserId: 'usr_3' });
  assert.equal(entry, null);
});

test('evaluateReserveRelease enforces schedule thresholds', () => {
  const entry = buildReserveLedgerEntry({
    reserveHoldCents: 5000,
    sellerUserId: 'usr_4',
    legId: 'leg_4',
    releaseAt: '2025-11-20T00:00:00Z'
  });
  const before = evaluateReserveRelease(entry, { nowIso: '2025-11-19T00:00:00Z' });
  assert.equal(before.shouldRelease, false);
  const after = evaluateReserveRelease(entry, { nowIso: '2025-11-21T00:00:00Z' });
  assert.equal(after.shouldRelease, true);
});

test('computePayout validates required inputs', () => {
  assert.throws(
    () => computePayout({ sellerUserId: 'usr', totalCents: 1000 }),
    (error) => error instanceof PayoutComputationError && error.code === 'LEG_ID_REQUIRED'
  );
});
