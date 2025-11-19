import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDepositClaimable,
  computeAvailableDeposit,
  createDepositClaimRecord,
  approveDepositClaim,
  denyDepositClaim,
  voidDepositClaim,
  DepositClaimError
} from '../../services/booking/deposits.js';

const DEPOSIT = Object.freeze({
  depositId: 'dep_123',
  legId: 'leg_studio',
  status: 'AUTHORIZED',
  authorizedCents: 50000,
  capturedCents: 0,
  expiresAt: '2025-12-15T00:00:00Z'
});

const LEG = Object.freeze({
  legId: 'leg_studio',
  endAt: '2025-12-10T20:00:00Z'
});

test('createDepositClaimRecord validates window and amount', () => {
  const claim = createDepositClaimRecord({
    deposit: DEPOSIT,
    leg: LEG,
    amountCents: 30000,
    reason: 'Equipment damage',
    evidenceRefs: ['https://evidence.example/photo1'],
    submittedBy: 'usr_studio_owner',
    nowIso: '2025-12-11T10:00:00Z',
    idFactory: (prefix) => `${prefix}_claim`
  });

  assert.equal(claim.claimId, 'dcl_claim');
  assert.equal(claim.status, 'pending');
  assert.equal(claim.evidence.length, 1);
});

test('approveDepositClaim updates claim and deposit snapshot', () => {
  const claim = {
    claimId: 'dcl_claim',
    depositId: 'dep_123',
    legId: 'leg_studio',
    status: 'pending',
    amountCents: 30000,
    capturedCents: 0,
    reason: 'Equipment damage',
    evidence: [],
    submittedBy: 'usr_studio_owner',
    createdAt: '2025-12-11T10:00:00Z',
    updatedAt: '2025-12-11T10:00:00Z'
  };

  const { claim: approved, deposit: updatedDeposit } = approveDepositClaim({
    claim,
    deposit: DEPOSIT,
    amountCents: 20000,
    approvedBy: 'usr_finance',
    decisionReason: 'Partial coverage',
    nowIso: '2025-12-12T09:00:00Z'
  });

  assert.equal(approved.status, 'captured');
  assert.equal(approved.capturedCents, 20000);
  assert.equal(updatedDeposit.capturedCents, 20000);
  assert.equal(updatedDeposit.status, 'CAPTURED');
});

test('denyDepositClaim transitions status properly', () => {
  const claim = {
    claimId: 'dcl_pending',
    depositId: 'dep_123',
    legId: 'leg_studio',
    status: 'pending',
    amountCents: 10000,
    capturedCents: 0,
    reason: 'Minor cleanup',
    evidence: [],
    submittedBy: 'usr_studio_owner',
    createdAt: '2025-12-11T10:00:00Z',
    updatedAt: '2025-12-11T10:00:00Z'
  };

  const denied = denyDepositClaim({
    claim,
    approvedBy: 'usr_finance',
    decisionReason: 'Insufficient evidence',
    nowIso: '2025-12-11T12:00:00Z'
  });

  assert.equal(denied.status, 'denied');
  assert.equal(denied.decisionReason, 'Insufficient evidence');
});

test('voidDepositClaim handles approved claim reversals', () => {
  const claim = {
    claimId: 'dcl_approved',
    depositId: 'dep_123',
    legId: 'leg_studio',
    status: 'approved',
    amountCents: 10000,
    capturedCents: 0,
    reason: 'Cleaning fee',
    evidence: [],
    submittedBy: 'usr_studio_owner',
    createdAt: '2025-12-11T10:00:00Z',
    updatedAt: '2025-12-11T10:00:00Z'
  };

  const voided = voidDepositClaim({
    claim,
    approvedBy: 'usr_finance',
    decisionReason: 'Seller withdrew request',
    nowIso: '2025-12-11T11:00:00Z'
  });

  assert.equal(voided.status, 'voided');
});

test('assertDepositClaimable enforces window boundaries', () => {
  assert.throws(
    () =>
      assertDepositClaimable({
        deposit: DEPOSIT,
        leg: LEG,
        nowIso: '2025-12-15T21:00:00Z',
        claimWindowHours: 72
      }),
    (error) => error instanceof DepositClaimError && error.code === 'DEPOSIT_CLAIM_WINDOW_EXPIRED'
  );
});

test('computeAvailableDeposit returns remaining authorization', () => {
  const remaining = computeAvailableDeposit({ authorizedCents: 50000, capturedCents: 15000 });
  assert.equal(remaining, 35000);
});
