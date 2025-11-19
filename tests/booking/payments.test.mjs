import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateChargeSplits,
  preparePaymentIntentPayload,
  shouldUseIncrementalCapture,
  PaymentInvariantError
} from '../../services/booking/payments.js';

const LEGS = [
  {
    legId: 'talent_leg',
    totalCents: 60000,
    sellerUserId: 'usr_talent_1',
    connectAccountId: 'acct_123'
  },
  {
    legId: 'studio_leg',
    totalCents: 40000,
    sellerUserId: 'usr_studio_1',
    connectAccountId: 'acct_456'
  }
];

test('allocateChargeSplits mirrors leg totals', () => {
  const splits = allocateChargeSplits(LEGS);
  assert.deepEqual(splits, [
    { legId: 'talent_leg', amountCents: 60000 },
    { legId: 'studio_leg', amountCents: 40000 }
  ]);
});

test('preparePaymentIntentPayload builds metadata and request structure', () => {
  const payload = preparePaymentIntentPayload({
    lbgId: 'lbg_123',
    chargeId: 'chg_123',
    currency: 'USD',
    legs: LEGS,
    paymentMethodKind: 'CARD',
    customerId: 'cus_999',
    paymentMethodId: 'pm_123',
    saveForFutureUse: true,
    confirm: true
  });

  assert.equal(payload.amountCents, 100000);
  assert.equal(payload.request.amount, 100000);
  assert.equal(payload.request.currency, 'usd');
  assert.deepEqual(payload.request.payment_method_types, ['card']);
  assert.equal(payload.request.metadata.lbg_id, 'lbg_123');
  assert.equal(payload.request.metadata.leg_ids, 'talent_leg,studio_leg');
  assert.equal(payload.request.transfer_group, 'lbg_lbg_123');
});

test('preparePaymentIntentPayload validates positive totals', () => {
  assert.throws(
    () =>
      preparePaymentIntentPayload({
        lbgId: 'lbg_456',
        currency: 'USD',
        legs: [{ legId: 'leg_negative', totalCents: -1 }],
        paymentMethodKind: 'CARD'
      }),
    (error) => error instanceof PaymentInvariantError && error.code === 'LEG_TOTAL_INVALID'
  );

  assert.throws(
    () =>
      preparePaymentIntentPayload({
        lbgId: 'lbg_456',
        currency: 'USD',
        legs: [{ legId: 'leg_zero', totalCents: 0 }],
        paymentMethodKind: 'CARD'
      }),
    (error) => error instanceof PaymentInvariantError && error.code === 'AMOUNT_REQUIRED'
  );
});

test('shouldUseIncrementalCapture detects incremental capability', () => {
  const charge = {
    status: 'AUTHORIZED',
    paymentMethod: 'CARD',
    supportsIncrementalCapture: true,
    authorizedCents: 100000,
    capturedCents: 60000
  };
  assert.equal(shouldUseIncrementalCapture(charge, 20000), true);
  assert.equal(shouldUseIncrementalCapture(charge, 50000), false);
});
