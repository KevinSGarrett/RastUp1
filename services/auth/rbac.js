import crypto from 'node:crypto';

import { requiresStepUp } from './mfa.js';

const DEFAULT_POLICY = Object.freeze({
  roles: [],
  requiresElevation: false,
  requiresMfa: false,
  requireTrustedDevice: false,
  riskThreshold: 0.75,
  mfaWindowMs: 10 * 60 * 1000,
  scope: undefined
});

const ACTION_POLICIES = Object.freeze({
  'profile:view_sensitive': {
    roles: ['admin', 'trust', 'support'],
    requiresMfa: true,
    mfaWindowMs: 5 * 60 * 1000,
    reason: 'sensitive_profile'
  },
  'payments:payout.update': {
    roles: ['buyer', 'provider', 'admin', 'trust'],
    requiresMfa: true,
    requireTrustedDevice: true,
    riskThreshold: 0.5,
    scope: { action: 'payments:payout.update' }
  },
  'admin:user.suspend': {
    roles: ['admin', 'support'],
    requiresElevation: true,
    requiresMfa: true,
    riskThreshold: 0.3,
    scope: { action: 'admin:user.suspend' }
  },
  'admin:impersonate': {
    roles: ['admin'],
    requiresElevation: true,
    requiresMfa: true,
    requireTrustedDevice: true,
    scope: { action: 'admin:impersonate' }
  },
  'session:revoke.other': {
    roles: ['admin', 'support'],
    requiresElevation: true,
    requireTrustedDevice: false,
    scope: { action: 'session:revoke.other' }
  }
});

function mergePolicy(action, overrides) {
  const base = ACTION_POLICIES[action] ?? {};
  return {
    ...DEFAULT_POLICY,
    ...base,
    ...(overrides ?? {})
  };
}

function hasRequiredRole(userRoles, requiredRoles) {
  if (!requiredRoles || requiredRoles.length === 0) {
    return true;
  }
  return requiredRoles.some((role) => userRoles.has(role));
}

function scopeAllows(elevationScope, requestedScope) {
  if (!elevationScope) {
    return false;
  }

  const matchesAction =
    elevationScope.action === '*' ||
    elevationScope.action === requestedScope.action;

  if (!matchesAction) {
    return false;
  }

  if (!elevationScope.resourceId) {
    return true;
  }

  return elevationScope.resourceId === requestedScope.resourceId;
}

export function isElevationActive(elevation, requestedScope, options = {}) {
  if (!elevation) {
    return false;
  }

  const now = typeof options.now === 'function' ? options.now() : options.now ?? Date.now();
  const expiresAt = Date.parse(elevation.expiresAt);
  if (!Number.isFinite(expiresAt) || now > expiresAt) {
    return false;
  }

  return scopeAllows(elevation.scope ?? {}, requestedScope);
}

export function createElevationRecord(options) {
  const {
    userId,
    sessionId,
    factorId,
    scope,
    clock = () => Date.now(),
    ttlSeconds = 15 * 60
  } = options;

  const grantedAtMs = clock();
  const expiresAtMs = grantedAtMs + ttlSeconds * 1000;

  return {
    elevationId: crypto.randomUUID(),
    userId,
    sessionId,
    factorId,
    scope,
    grantedAt: new Date(grantedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

export function authorize(input) {
  const {
    action,
    context,
    resourceId,
    overrides
  } = input;

  const policy = mergePolicy(action, overrides);
  const userRoles = new Set(context?.roles ?? []);

  if (!hasRequiredRole(userRoles, policy.roles)) {
    return {
      allow: false,
      reason: 'ROLE_MISSING',
      requiredRoles: policy.roles ?? []
    };
  }

  const nowFn = typeof policy.now === 'function' ? policy.now : () => Date.now();
  const nowMs = nowFn();

  const scope = policy.scope ?? { action, resourceId: resourceId ?? null };

  const elevationActive = policy.requiresElevation
    ? isElevationActive(context?.elevation ?? null, scope, { now: nowMs })
    : false;

  if (policy.requiresElevation && !elevationActive) {
    return {
      allow: false,
      reason: 'ELEVATION_REQUIRED',
      requiresElevation: true,
      requiredRoles: policy.roles ?? [],
      elevationScope: scope
    };
  }

  const stepUp = requiresStepUp(
    action,
    {
      mfaVerifiedAt: context?.mfaVerifiedAt,
      trustedDevice: context?.trustedDevice,
      riskScore: context?.riskScore
    },
    {
      force: policy.requiresMfa && !elevationActive,
      riskThreshold: policy.riskThreshold,
      requireTrustedDevice: policy.requireTrustedDevice,
      maxAgeMs: policy.mfaWindowMs,
      now: () => nowMs
    }
  );

  if (stepUp.required) {
    if (policy.requiresElevation && elevationActive) {
      return {
        allow: false,
        reason: 'STEP_UP_REQUIRED',
        requiresMfa: true,
        requiredRoles: policy.roles ?? [],
        elevationScope: scope,
        stepUp
      };
    }
    return {
      allow: false,
      reason: 'STEP_UP_REQUIRED',
      requiresMfa: true,
      requiredRoles: policy.roles ?? [],
      elevationScope: scope,
      stepUp
    };
  }

  if (policy.maxRiskScore !== undefined && (context?.riskScore ?? 0) > policy.maxRiskScore) {
    return {
      allow: false,
      reason: 'RISK_TOO_HIGH',
      requiredRoles: policy.roles ?? [],
      elevationScope: scope
    };
  }

  return {
    allow: true,
    requiredRoles: policy.roles ?? [],
    elevationScope: scope
  };
}

export const policies = {
  DEFAULT_POLICY,
  ACTION_POLICIES
};
