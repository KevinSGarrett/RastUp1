import test from 'node:test';
import assert from 'node:assert/strict';

import { createReceiptManifests } from '../../services/booking/receipts.js';

const LBG = Object.freeze({
  lbgId: 'lbg_rcpt',
  status: 'CONFIRMED',
  currency: 'USD'
});

const LEGS = Object.freeze([
  {
    legId: 'leg_talent',
    title: 'Talent Session',
    subtotalCents: 60000,
    taxCents: 5000,
    feesCents: 3000,
    totalCents: 68000,
    currency: 'USD',
    policy: { version: 1 }
  },
  {
    legId: 'leg_studio',
    title: 'Studio Rental',
    subtotalCents: 40000,
    taxCents: 3200,
    feesCents: 1800,
    totalCents: 45000,
    currency: 'USD',
    policy: { version: 1 }
  }
]);

const CHARGE = Object.freeze({
  chargeId: 'chg_lbg_rcpt',
  processor: 'stripe',
  processorIntent: 'pi_123',
  amountCents: 113000,
  status: 'CAPTURED',
  capturedAt: '2025-12-01T10:00:00Z',
  paymentMethod: 'CARD'
});

test('createReceiptManifests builds leg and group receipts with deterministic ids', () => {
  const idSequence = ['rcpt_1', 'rcpt_2', 'rcpt_group'];
  let index = 0;
  const amendmentsByLeg = new Map([
    [
      'leg_talent',
      [
        {
          amendmentId: 'amd_123',
          kind: 'change_order',
          deltaSubtotalCents: 5000,
          deltaTaxCents: 400,
          deltaFeesCents: 100,
          deltaTotalCents: 5500,
          createdAt: '2025-12-02T10:00:00Z',
          createdBy: 'usr_finance'
        }
      ]
    ]
  ]);

  const refundsByLeg = new Map([
    [
      'leg_studio',
      [{ refundId: 'rfd_123', status: 'SUCCEEDED', amountCents: 5000, processor: 'stripe', processorRefund: 're_123', createdAt: '2025-12-03T12:00:00Z' }]
    ]
  ]);

  const legDocHashes = new Map([
    ['leg_talent', ['doc_hash_talent']],
    ['leg_studio', ['doc_hash_studio']]
  ]);

  const { manifests, legReceipts, groupReceipt } = createReceiptManifests({
    lbg: LBG,
    legs: LEGS,
    charge: CHARGE,
    amendmentsByLeg,
    refundsByLeg,
    legDocHashes,
    groupDocHashes: ['group_hash'],
    generatedAt: '2025-12-11T09:00:00Z',
    idFactory: () => idSequence[index++],
    storageUrlFactory: (kind, legId) => (kind === 'leg' ? `s3://receipts/${legId}.pdf` : 's3://receipts/group.pdf')
  });

  assert.equal(manifests.length, 3);
  assert.deepEqual(
    manifests.map((manifest) => manifest.receiptId),
    ['rcpt_1', 'rcpt_2', 'rcpt_group']
  );
  assert.equal(groupReceipt.totalCents, 113000);
  assert.equal(legReceipts[0].docHashes[0], 'doc_hash_talent');
  assert.equal(manifests[2].storageUrl, 's3://receipts/group.pdf');
});
