import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldStepUp,
  MFA_POLICY_DEFAULTS,
} from '../../../tools/frontend/auth/mfa_policy.mjs';

test('mandatory actions always require step-up', () => {
  const result = shouldStepUp('payout_change', {
    availableFactors: ['sms'],
    riskScore: 10,
    trustedDevice: true,
    trustedAt: Date.now(),
  });
  assert.equal(result.required, true);
  assert.ok(result.reasons.includes('action_mandatory'));
  assert.deepEqual(result.recommendedFactors, ['sms']);
});

test('high risk score triggers step-up even for non-mandatory action', () => {
  const result = shouldStepUp('update_bio', {
    riskScore: 90,
    availableFactors: ['sms', 'totp'],
    trustedDevice: true,
    trustedAt: Date.now(),
  });
  assert.equal(result.required, true);
  assert.ok(result.reasons.includes('high_risk_score'));
  assert.deepEqual(result.recommendedFactors, ['totp', 'sms']);
});

test('untrusted device triggers step-up when policy requires', () => {
  const now = Date.now();
  const result = shouldStepUp('change_password', {
    riskScore: 20,
    trustedDevice: false,
    availableFactors: ['totp'],
    sessionAgeMinutes: 30,
    trustedAt: now - 1000,
  });
  assert.equal(result.required, true);
  assert.ok(result.reasons.includes('device_untrusted'));
});

test('trusted device within TTL does not require step-up for low risk action', () => {
  const now = Date.now();
  const result = shouldStepUp('update_display_name', {
    riskScore: 10,
    trustedDevice: true,
    trustedAt: now,
    availableFactors: ['totp', 'sms'],
    sessionAgeMinutes: 30,
  });
  assert.equal(result.required, false);
  assert.ok(result.reasons.includes('baseline_mfa_recommended') === false);
});
