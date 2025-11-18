import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessPassword,
  calculatePasswordScore,
  PASSWORD_POLICY_DEFAULTS,
} from '../../../tools/frontend/auth/password_policy.mjs';

test('calculatePasswordScore rewards length and variety', () => {
  const result = calculatePasswordScore('StrongPassw0rd!');
  assert.ok(result.total >= 70, 'score should be at least 70 for a strong password');
  assert.ok(result.requirements.lowercase.present);
  assert.ok(result.requirements.uppercase.present);
  assert.ok(result.requirements.digit.present);
  assert.ok(result.requirements.symbol.present);
});

test('assessPassword rejects passwords without digits', async () => {
  const outcome = await assessPassword('PasswordOnly!', { config: PASSWORD_POLICY_DEFAULTS });
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((msg) => msg.includes('number')));
});

test('assessPassword rejects banned passwords', async () => {
  const outcome = await assessPassword('password', { config: PASSWORD_POLICY_DEFAULTS });
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.some((msg) => msg.includes('banned')));
});

test('assessPassword surfaces breach results', async () => {
  const breachChecker = async () => ({ breached: true, occurrences: 42 });
  const outcome = await assessPassword('UniqueButBreached1!', { breachChecker });
  assert.equal(outcome.valid, false);
  assert.equal(outcome.breached, true);
  assert.ok(outcome.errors.some((msg) => msg.includes('breach corpus')));
});

test('assessPassword handles breach checker failures gracefully', async () => {
  const breachChecker = async () => {
    throw new Error('service unavailable');
  };
  const outcome = await assessPassword('ResilientPass123!', { breachChecker });
  assert.equal(outcome.valid, true);
  assert.ok(outcome.warnings.some((msg) => msg.includes('Breach check failed')));
});
