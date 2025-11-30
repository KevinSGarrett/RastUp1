import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enrollSmsFactor,
  issueSmsChallenge,
  verifyChallenge,
  requiresStepUp
} from '../../services/auth/mfa.js';

test('enrollSmsFactor normalizes phone and hashes backup codes', () => {
  let seed = 1;
  const randomBytes = (size) => Buffer.alloc(size, seed++);

  const { factor, backupCodes } = enrollSmsFactor({
    userId: 'user-111',
    phoneNumber: '(415) 555-0100',
    randomBytes,
    backupCodePepper: 'pepper'
  });

  assert.equal(factor.phoneE164, '+14155550100');
  assert.equal(factor.type, 'sms_otp');
  assert.equal(factor.status, 'pending');
  assert.equal(factor.backupCodes.length, backupCodes.length);

  factor.backupCodes.forEach((stored, idx) => {
    assert.ok(stored.startsWith('sha256:'), 'backup code hash uses sha256');
    assert.notEqual(stored, backupCodes[idx], 'stored code is hashed');
  });
});

test('verifyChallenge enforces attempt limit and success path', () => {
  const { factor } = enrollSmsFactor({
    userId: 'user-222',
    phoneNumber: '+1 212 555 2222'
  });

  const challengeResult = issueSmsChallenge({
    factor,
    sessionId: 'session-1',
    ttlSeconds: 5,
    codePepper: 'pepper'
  });

  const bad = verifyChallenge(challengeResult.challenge, '000000', {
    codePepper: 'pepper',
    clock: () => Date.now()
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 'invalid');
  assert.equal(bad.challenge.attempts, 1);

  const success = verifyChallenge(bad.challenge, challengeResult.code, {
    codePepper: 'pepper',
    clock: () => Date.now()
  });
  assert.equal(success.ok, true);
  assert.equal(success.status, 'verified');
  assert.equal(success.challenge.attempts, 2);
});

test('verifyChallenge locks after max attempts or expiry', () => {
  const { factor } = enrollSmsFactor({
    userId: 'user-333',
    phoneNumber: '+442071838750'
  });

  const issued = issueSmsChallenge({
    factor,
    sessionId: 'session-2',
    ttlSeconds: 1,
    maxAttempts: 2,
    codePepper: 'pepper',
    randomBytes: (size) => Buffer.alloc(size, 3)
  });

  const firstFail = verifyChallenge(issued.challenge, '999999', {
    codePepper: 'pepper',
    clock: () => Date.now()
  });
  assert.equal(firstFail.status, 'invalid');
  assert.equal(firstFail.challenge.attempts, 1);

  const locked = verifyChallenge(firstFail.challenge, '888888', {
    codePepper: 'pepper',
    clock: () => Date.now()
  });
  assert.equal(locked.ok, false);
  assert.equal(locked.status, 'locked');

  const expired = verifyChallenge(issued.challenge, '111111', {
    codePepper: 'pepper',
    clock: () => Date.now() + 10_000
  });
  assert.equal(expired.status, 'expired');
});

test('requiresStepUp evaluates risk and device trust', () => {
  const outcome = requiresStepUp('payments:payout.update', {
    trustedDevice: false,
    riskScore: 0.8,
    mfaVerifiedAt: null
  });

  assert.equal(outcome.required, true);
  assert.ok(outcome.factors.includes('sms_otp'));
  assert.ok(outcome.reasons.includes('untrusted_device'));
  assert.ok(outcome.reasons.includes('risk'));
});
