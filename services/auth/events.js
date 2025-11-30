import crypto from 'node:crypto';

import { AuthError, ERROR_CODES } from './errors.js';

const EVENT_DEFINITIONS = Object.freeze({
  'session.created': { eventName: 'auth.session.created', version: 1, severity: 'info' },
  'session.refreshed': { eventName: 'auth.session.refreshed', version: 1, severity: 'info' },
  'mfa.challenge_issued': { eventName: 'auth.mfa.challenge_issued', version: 1, severity: 'medium' },
  'mfa.challenge_verified': { eventName: 'auth.mfa.challenge_verified', version: 1, severity: 'info' },
  'admin.elevation_granted': { eventName: 'auth.admin.elevation_granted', version: 1, severity: 'high' }
});

function resolveEventDefinition(key) {
  if (!key) {
    throw new AuthError({
      code: ERROR_CODES.PROVIDER_MISCONFIGURED,
      message: 'Event key is required.'
    });
  }
  const normalized = key.startsWith('auth.') ? key.slice('auth.'.length) : key;
  const def = EVENT_DEFINITIONS[normalized];
  if (!def) {
    throw new AuthError({
      code: ERROR_CODES.PROVIDER_MISCONFIGURED,
      message: `Unknown auth event key: ${key}`,
      details: { key }
    });
  }
  return def;
}

function defaultOccurredAt(options) {
  if (options?.occurredAt) {
    return options.occurredAt;
  }
  const clock = typeof options?.clock === 'function' ? options.clock : () => Date.now();
  return new Date(clock()).toISOString();
}

export function buildAuthEventEnvelope(eventKey, payload, options = {}) {
  const definition = resolveEventDefinition(eventKey);
  const occurredAt = defaultOccurredAt(options);
  const correlationId = options.correlationId ?? crypto.randomUUID();

  return {
    eventName: definition.eventName,
    version: definition.version,
    occurredAt,
    payload,
    actor: {
      userId: options.userId ?? null,
      sessionId: options.sessionId ?? null,
      actorType: options.actorType ?? 'user'
    },
    context: {
      ipAddress: options.ipAddress ?? null,
      userAgent: options.userAgent ?? null,
      deviceId: options.deviceId ?? null
    },
    metadata: {
      correlationId,
      source: options.source ?? 'services/auth',
      severity: options.severity ?? definition.severity,
      blueprint: options.blueprint ?? null
    }
  };
}

export function buildSessionCreatedEvent(options) {
  const { session, request } = options;
  return buildAuthEventEnvelope('session.created', {
    session_id: session.sessionId,
    user_id: session.userId,
    device_id: session.deviceId,
    trusted_device: session.trustedDevice,
    risk_score: Number(session.riskScore ?? 0),
    ip_address: request?.ipAddress ?? session.ipAddress ?? null
  }, {
    userId: session.userId,
    sessionId: session.sessionId,
    ipAddress: request?.ipAddress ?? session.ipAddress,
    userAgent: request?.userAgent ?? session.userAgent,
    deviceId: session.deviceId,
    blueprint: 'TD-0312'
  });
}

export function buildSessionRefreshedEvent(options) {
  const { session, refreshReason } = options;
  return buildAuthEventEnvelope('session.refreshed', {
    session_id: session.sessionId,
    user_id: session.userId,
    refresh_reason: refreshReason ?? 'rotation',
    idle_expires_at: session.idleExpiresAt,
    rotated_at: session.rotatedAt
  }, {
    userId: session.userId,
    sessionId: session.sessionId,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent
  });
}

export function buildMfaChallengeIssuedEvent(options) {
  const { challenge, factor, sms, reason } = options;
  return buildAuthEventEnvelope('mfa.challenge_issued', {
    challenge_id: challenge.challengeId,
    factor_id: factor.factorId,
    user_id: factor.userId,
    challenge_type: challenge.type,
    max_attempts: challenge.maxAttempts,
    expires_at: challenge.expiresAt,
    delivery: {
      channel: 'sms',
      to: sms?.to ?? factor.phoneE164,
      template_id: sms?.templateId ?? null
    },
    reason: reason ?? null
  }, {
    userId: factor.userId,
    sessionId: challenge.sessionId,
    severity: 'medium'
  });
}

export function buildMfaChallengeVerifiedEvent(options) {
  const { challenge, factor, method } = options;
  return buildAuthEventEnvelope('mfa.challenge_verified', {
    challenge_id: challenge.challengeId,
    factor_id: factor.factorId,
    user_id: factor.userId,
    challenge_type: challenge.type,
    method: method ?? 'code',
    attempts: challenge.attempts
  }, {
    userId: factor.userId,
    sessionId: challenge.sessionId,
    severity: 'info'
  });
}

export function buildAdminElevationGrantedEvent(options) {
  const { elevation, actor, reason } = options;
  return buildAuthEventEnvelope('admin.elevation_granted', {
    elevation_id: elevation.elevationId,
    user_id: elevation.userId,
    session_id: elevation.sessionId,
    factor_id: elevation.factorId,
    scope: elevation.scope,
    expires_at: elevation.expiresAt,
    reason: reason ?? null
  }, {
    userId: actor?.userId ?? elevation.userId,
    sessionId: actor?.sessionId ?? elevation.sessionId,
    severity: 'high'
  });
}

export const __testables = {
  resolveEventDefinition,
  defaultOccurredAt
};
