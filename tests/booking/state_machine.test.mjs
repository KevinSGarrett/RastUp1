import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidLegTransition,
  deriveLbgStatus,
  ensureAtomicConfirmation,
  applyAmendmentToLeg,
  calculateAggregateTotals,
  StateInvariantError
} from '../../services/booking/state.js';

const BASE_LEG = Object.freeze({
  legId: 'leg_1',
  type: 'TALENT',
  status: 'AWAITING_PAYMENT',
  title: 'Studio Session',
  startAt: '2025-12-01T17:00:00Z',
  endAt: '2025-12-01T19:00:00Z',
  subtotalCents: 50000,
  taxCents: 5000,
  feesCents: 2500,
  totalCents: 57500,
  currency: 'USD',
  policy: { version: 1, bands: [{ fromHours: 24, buyerRefundPct: 100, sellerPayoutPct: 0 }] },
  docsSigned: true,
  createdAt: '2025-11-18T00:00:00Z',
  updatedAt: '2025-11-18T00:00:00Z'
});

test('isValidLegTransition honours sequential state flows', () => {
  assert.equal(isValidLegTransition('DRAFT', 'AWAITING_DOCS'), true);
  assert.equal(isValidLegTransition('AWAITING_DOCS', 'AWAITING_PAYMENT'), true);
  assert.equal(isValidLegTransition('CONFIRMED', 'COMPLETED'), false);
  assert.equal(isValidLegTransition('COMPLETED', 'IN_PROGRESS'), false);
});

test('deriveLbgStatus maps leg states to group state', () => {
  const legsDraft = [{ ...BASE_LEG, status: 'AWAITING_DOCS' }, { ...BASE_LEG, legId: 'leg_2', status: 'DRAFT' }];
  assert.equal(deriveLbgStatus(legsDraft), 'AWAITING_DOCS');

  const legsConfirmed = [{ ...BASE_LEG, status: 'CONFIRMED' }, { ...BASE_LEG, legId: 'leg_2', status: 'CONFIRMED' }];
  assert.equal(deriveLbgStatus(legsConfirmed), 'CONFIRMED');

  const legsInProgress = [{ ...BASE_LEG, status: 'IN_PROGRESS' }, { ...BASE_LEG, legId: 'leg_2', status: 'CONFIRMED' }];
  assert.equal(deriveLbgStatus(legsInProgress), 'IN_PROGRESS');

  const legsCancelled = [{ ...BASE_LEG, status: 'CANCELLED' }, { ...BASE_LEG, legId: 'leg_2', status: 'CANCELLED' }];
  assert.equal(deriveLbgStatus(legsCancelled), 'CANCELLED');
});

test('ensureAtomicConfirmation enforces docs-before-pay and leg readiness', () => {
  const legsReady = [
    BASE_LEG,
    { ...BASE_LEG, legId: 'leg_2', status: 'AWAITING_PAYMENT', docsSigned: true }
  ];
  assert.equal(ensureAtomicConfirmation({ legs: legsReady, docsSigned: true, chargeStatus: 'AUTHORIZED' }), true);

  const legsMissingDocs = [{ ...BASE_LEG, docsSigned: false }];
  assert.throws(
    () => ensureAtomicConfirmation({ legs: legsMissingDocs, docsSigned: false, chargeStatus: 'AUTHORIZED' }),
    (error) => error instanceof StateInvariantError && error.code === 'DOCS_NOT_SIGNED'
  );

  const legsWrongStatus = [{ ...BASE_LEG, status: 'AWAITING_DOCS' }];
  assert.throws(
    () => ensureAtomicConfirmation({ legs: legsWrongStatus, docsSigned: true, chargeStatus: 'AUTHORIZED' }),
    (error) => error instanceof StateInvariantError && error.code === 'BOOKING_LEG_NOT_READY'
  );

  assert.throws(
    () => ensureAtomicConfirmation({ legs: legsReady, docsSigned: true, chargeStatus: 'REQUIRES_ACTION' }),
    (error) => error instanceof StateInvariantError && error.code === 'CHARGE_NOT_READY'
  );
});

test('applyAmendmentToLeg updates monetary totals and guards invariants', () => {
  const amendment = {
    deltaSubtotalCents: 10000,
    deltaTaxCents: 800,
    deltaFeesCents: 200,
    deltaTotalCents: 11000
  };
  const updatedLeg = applyAmendmentToLeg(BASE_LEG, amendment);
  assert.equal(updatedLeg.totalCents, BASE_LEG.totalCents + 11000);

  const totals = calculateAggregateTotals([updatedLeg]);
  assert.deepEqual(totals, {
    subtotalCents: BASE_LEG.subtotalCents + 10000,
    taxCents: BASE_LEG.taxCents + 800,
    feesCents: BASE_LEG.feesCents + 200,
    totalCents: BASE_LEG.totalCents + 11000
  });

  const badAmendment = { ...amendment, deltaTotalCents: 1000 };
  assert.throws(
    () => applyAmendmentToLeg(BASE_LEG, badAmendment),
    (error) => error instanceof StateInvariantError && error.code === 'TOTAL_MISMATCH'
  );
});
