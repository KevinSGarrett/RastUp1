import test from 'node:test';
import assert from 'node:assert/strict';

import { authorize, createElevationRecord } from '../../services/auth/rbac.js';

test('buyer role is denied admin action', () => {
  const decision = authorize({
    action: 'admin:user.suspend',
    context: {
      userId: 'user-buyer',
      roles: ['buyer'],
      sessionId: 'session-1',
      trustedDevice: false,
      riskScore: 0.1
    }
  });

  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'ROLE_MISSING');
  assert.deepEqual(decision.requiredRoles.sort(), ['admin', 'support']);
});

test('admin without elevation requires step-up', () => {
  const decision = authorize({
    action: 'admin:user.suspend',
    context: {
      userId: 'user-admin',
      roles: ['admin'],
      sessionId: 'session-2',
      trustedDevice: true,
      riskScore: 0.2,
      mfaVerifiedAt: new Date().toISOString()
    }
  });

  assert.equal(decision.allow, false);
  assert.equal(decision.reason, 'ELEVATION_REQUIRED');
  assert.equal(decision.requiresElevation, true);
});

test('admin with valid elevation is allowed', () => {
  const elevation = createElevationRecord({
    userId: 'user-admin',
    sessionId: 'session-3',
    factorId: 'factor-1',
    scope: { action: 'admin:user.suspend' },
    clock: () => 1764361200000,
    ttlSeconds: 900
  });

  const decision = authorize({
    action: 'admin:user.suspend',
    context: {
      userId: 'user-admin',
      roles: ['admin'],
      sessionId: 'session-3',
      trustedDevice: true,
      riskScore: 0.1,
      mfaVerifiedAt: new Date(1764361200000).toISOString(),
      elevation
    },
    overrides: {
      now: () => 1764361500000
    }
  });

  assert.equal(decision.allow, true);
  assert.deepEqual(decision.requiredRoles, ['admin', 'support']);
});
