import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSessionCreatedEvent,
  buildMfaChallengeIssuedEvent,
  buildAuthEventEnvelope
} from '../../services/auth/events.js';
import { AuthError, ERROR_CODES } from '../../services/auth/errors.js';

test('buildSessionCreatedEvent produces structured envelope', () => {
  const envelope = buildSessionCreatedEvent({
    session: {
      sessionId: 'session-123',
      userId: 'user-123',
      deviceId: 'device-1',
      refreshHash: 'hash',
      refreshSalt: 'salt',
      status: 'active',
      issuedAt: '2025-11-29T03:00:00Z',
      rotatedAt: '2025-11-29T03:00:00Z',
      expiresAt: '2025-11-29T04:00:00Z',
      idleExpiresAt: '2025-11-29T03:30:00Z',
      trustedDevice: false,
      riskScore: 0.42,
      userAgent: 'TestAgent/1.0',
      ipAddress: '203.0.113.8'
    },
    request: { ipAddress: '203.0.113.8', userAgent: 'TestAgent/1.0' }
  });

  assert.equal(envelope.eventName, 'auth.session.created');
  assert.equal(envelope.version, 1);
  assert.equal(envelope.payload.session_id, 'session-123');
  assert.equal(envelope.payload.user_id, 'user-123');
  assert.equal(envelope.metadata.severity, 'info');
  assert.ok(envelope.metadata.correlationId);
  assert.equal(envelope.context.ipAddress, '203.0.113.8');
});

test('buildMfaChallengeIssuedEvent includes delivery metadata', () => {
  const envelope = buildMfaChallengeIssuedEvent({
    challenge: {
      challengeId: 'chal-1',
      factorId: 'factor-1',
      userId: 'user-1',
      sessionId: 'session-1',
      type: 'sms_otp',
      issuedAt: '2025-11-29T03:00:00Z',
      expiresAt: '2025-11-29T03:05:00Z',
      attempts: 0,
      maxAttempts: 5
    },
    factor: {
      factorId: 'factor-1',
      userId: 'user-1',
      type: 'sms_otp',
      status: 'active',
      phoneE164: '+15555550100',
      backupCodes: [],
      createdAt: '2025-11-29T02:00:00Z'
    },
    sms: { to: '+15555550100', templateId: 'sms-template-1' },
    reason: 'step_up'
  });

  assert.equal(envelope.eventName, 'auth.mfa.challenge_issued');
  assert.equal(envelope.metadata.severity, 'medium');
  assert.equal(envelope.payload.delivery.channel, 'sms');
  assert.equal(envelope.payload.delivery.to, '+15555550100');
});

test('buildAuthEventEnvelope rejects unknown keys', () => {
  assert.throws(
    () => buildAuthEventEnvelope('unknown.event', {}),
    (error) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, ERROR_CODES.PROVIDER_MISCONFIGURED);
      return true;
    }
  );
});
