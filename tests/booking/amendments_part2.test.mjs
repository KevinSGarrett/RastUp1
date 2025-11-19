import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChangeOrderLine,
  buildOvertimeLine,
  createAmendmentDraft,
  determinePaymentStrategy,
  ensureAmendmentWindow,
  summarizeAmendments,
  AmendmentInvariantError
} from '../../services/booking/amendments.js';

const BASE_LEG = Object.freeze({
  legId: 'leg_part2',
  title: 'Studio Session',
  startAt: '2025-12-10T10:00:00Z',
  endAt: '2025-12-10T12:00:00Z',
  subtotalCents: 50000,
  taxCents: 4000,
  feesCents: 2000,
  totalCents: 56000,
  currency: 'USD',
  policy: { version: 1, bands: [{ fromHours: 24, buyerRefundPct: 100, sellerPayoutPct: 0 }] }
});

test('buildChangeOrderLine constructs normalized line and validates inputs', () => {
  const line = buildChangeOrderLine({ name: 'Additional Look', quantity: 2, unitPriceCents: 15000 });
  assert.deepEqual(line, {
    name: 'Additional Look',
    quantity: 2,
    unitPriceCents: 15000,
    totalCents: 30000,
    notes: undefined
  });

  assert.throws(
    () => buildChangeOrderLine({ name: '', unitPriceCents: 1000 }),
    (error) => error instanceof AmendmentInvariantError && error.code === 'AMENDMENT_LINE_NAME_REQUIRED'
  );
});

test('createAmendmentDraft produces amendment delta and patched leg snapshot', () => {
  const line = buildChangeOrderLine({ name: 'Change Order', unitPriceCents: 10000 });
  const { draft, updatedLeg, deltas } = createAmendmentDraft({
    leg: BASE_LEG,
    kind: 'change_order',
    line,
    taxCents: 800,
    feesCents: 200,
    createdBy: 'usr_finance_1',
    idFactory: (prefix) => `${prefix}_deterministic`,
    nowIso: '2025-12-09T08:00:00Z'
  });

  assert.equal(draft.amendmentId, 'amd_deterministic');
  assert.equal(deltas.deltaTotalCents, 11000);
  assert.equal(updatedLeg.totalCents, BASE_LEG.totalCents + 11000);
});

test('determinePaymentStrategy prefers incremental capture when supported', () => {
  const strategy = determinePaymentStrategy({
    charge: {
      status: 'AUTHORIZED',
      paymentMethod: 'CARD',
      supportsIncrementalCapture: true,
      authorizedCents: 100000,
      capturedCents: 60000
    },
    paymentMethodKind: 'CARD',
    deltaTotalCents: 20000
  });

  assert.deepEqual(strategy, {
    strategy: 'INCREMENTAL_CAPTURE',
    reason: 'Charge supports incremental capture for requested delta.'
  });

  const fallback = determinePaymentStrategy({
    charge: {
      status: 'AUTHORIZED',
      paymentMethod: 'CARD',
      supportsIncrementalCapture: false,
      authorizedCents: 100000,
      capturedCents: 60000
    },
    paymentMethodKind: 'CARD',
    deltaTotalCents: 20000
  });

  assert.equal(fallback.strategy, 'NEW_INTENT');
});

test('ensureAmendmentWindow enforces pre-session vs post-session guardrails', () => {
  assert.throws(
    () =>
      ensureAmendmentWindow({
        leg: BASE_LEG,
        kind: 'change_order',
        nowIso: '2025-12-10T11:00:00Z'
      }),
    (error) => error instanceof AmendmentInvariantError && error.code === 'AMENDMENT_NOT_ALLOWED_WINDOW'
  );

  const overtimeLine = buildOvertimeLine({ minutes: 30, ratePerMinuteCents: 500 });
  const { updatedLeg } = createAmendmentDraft({
    leg: BASE_LEG,
    kind: 'overtime',
    line: overtimeLine,
    createdBy: 'usr_finance_1',
    idFactory: (prefix) => `${prefix}_overtime`,
    taxCents: 0,
    feesCents: 0,
    nowIso: '2025-12-10T11:00:00Z'
  });

  assert.equal(updatedLeg.totalCents, BASE_LEG.totalCents + overtimeLine.totalCents);
});

test('summarizeAmendments aggregates monetary deltas correctly', () => {
  const summary = summarizeAmendments([
    { deltaSubtotalCents: 10000, deltaTaxCents: 800, deltaFeesCents: 200, deltaTotalCents: 11000 },
    { deltaSubtotalCents: 5000, deltaTaxCents: 400, deltaFeesCents: 100, deltaTotalCents: 5500 }
  ]);

  assert.deepEqual(summary, {
    subtotalCents: 15000,
    taxCents: 1200,
    feesCents: 300,
    totalCents: 16500
  });
});
