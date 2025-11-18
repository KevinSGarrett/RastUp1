import test from 'node:test';
import assert from 'node:assert/strict';

import {
  registerAttempt,
  formatDecision,
  LOCKOUT_POLICY_DEFAULTS,
} from '../../../tools/frontend/auth/lockout_policy.mjs';

test('registerAttempt locks account after max failures', () => {
  let state = {};
  let decision;
  const baseTime = Date.now();
  for (let i = 0; i < LOCKOUT_POLICY_DEFAULTS.maxFailures; i += 1) {
    ({ state, decision } = registerAttempt(
      state,
      { success: false, timestamp: baseTime + i * 1000 },
      LOCKOUT_POLICY_DEFAULTS,
    ));
  }
  assert.ok(decision.locked, 'account should be locked');
  assert.ok(decision.lockedUntil > baseTime);
  const secondsRemaining = Math.round((decision.lockedUntil - baseTime) / 1000);
  assert.ok(
    secondsRemaining >= 895 && secondsRemaining <= 905,
    `lockout should be roughly 900 seconds, received ${secondsRemaining}`,
  );
  assert.ok(formatDecision(decision, baseTime).startsWith('locked:'), 'formatDecision should indicate locked state');
});

test('registerAttempt triggers captcha based on risk score', () => {
  const now = Date.now();
  const { decision } = registerAttempt(
    {},
    { success: false, riskScore: 95, timestamp: now },
    LOCKOUT_POLICY_DEFAULTS,
  );
  assert.ok(decision.locked, 'high risk should trigger lockout');
  assert.ok(decision.captchaRequired, 'captcha required for high risk');
});

test('successful login resets failures and lockout', () => {
  const baseTime = Date.now();
  let state = {};
  ({ state } = registerAttempt(
    state,
    { success: false, timestamp: baseTime },
    LOCKOUT_POLICY_DEFAULTS,
  ));
  ({ state } = registerAttempt(
    state,
    { success: false, timestamp: baseTime + 1000 },
    LOCKOUT_POLICY_DEFAULTS,
  ));
  const result = registerAttempt(
    state,
    { success: true, timestamp: baseTime + 2000 },
    LOCKOUT_POLICY_DEFAULTS,
  );
  assert.equal(result.state.failures.length, 0);
  assert.equal(result.decision.locked, false);
  assert.equal(result.decision.captchaRequired, false);
});
