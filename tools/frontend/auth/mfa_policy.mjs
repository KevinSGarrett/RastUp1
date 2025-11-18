const DEFAULT_POLICY = Object.freeze({
  mandatoryActions: new Set(['payout_change', 'view_dsar_export', 'email_change']),
  elevatedActions: new Set([
    'view_payout_history',
    'download_invoice',
    'change_password',
    'view_sensitive_media',
  ]),
  riskThreshold: 65,
  stepUpForUntrustedDevice: true,
  sessionMinutesBeforeStepUp: 720, // 12 hours
  trustedDeviceTtlMinutes: 43200, // 30 days
  preferredFactorsOrder: ['totp', 'sms', 'email', 'backup_codes'],
});

/**
 * Determines whether the UI should prompt for MFA step-up.
 *
 * @param {string} action - action key (e.g. 'payout_change')
 * @param {object} context - runtime context
 * @param {number} [context.riskScore=0] - 0-100 scale
 * @param {boolean} [context.trustedDevice=false] - whether device previously trusted
 * @param {number} [context.trustedAt] - epoch ms when device trusted
 * @param {number} [context.sessionAgeMinutes=0] - age of session
 * @param {Set<string>|string[]} [context.availableFactors] - factors user has enrolled
 * @param {boolean} [context.mfaEnabled] - baseline MFA preference
 * @param {object} [policy]
 * @returns {{required: boolean, reasons: string[], recommendedFactors: string[]}}
 */
export function shouldStepUp(
  action,
  context = {},
  policy = DEFAULT_POLICY,
) {
  const reasons = [];
  const availableFactors = normaliseFactors(context.availableFactors);

  if (!action) {
    return { required: false, reasons: ['unknown_action'], recommendedFactors: availableFactors };
  }

  if (policy.mandatoryActions?.has?.(action) || policy.mandatoryActions?.includes?.(action)) {
    reasons.push('action_mandatory');
  }

  const riskScore = context.riskScore ?? 0;
  if (riskScore >= (policy.riskThreshold ?? 65)) {
    reasons.push('high_risk_score');
  }

  const sessionAge = context.sessionAgeMinutes ?? 0;
  if (sessionAge >= (policy.sessionMinutesBeforeStepUp ?? 720)) {
    reasons.push('session_stale');
  }

  const trustedDevice = Boolean(context.trustedDevice);
  const trustedAt = context.trustedAt ?? null;
  const trustedDeviceTtl = minutesToMs(policy.trustedDeviceTtlMinutes ?? 43200);
  const now = context.now ?? Date.now();

  if (trustedDevice && typeof trustedAt === 'number') {
    if (trustedAt + trustedDeviceTtl < now) {
      reasons.push('trusted_device_expired');
    }
  } else if (policy.stepUpForUntrustedDevice !== false) {
    reasons.push('device_untrusted');
  }

  if (
    policy.elevatedActions?.has?.(action) ||
    policy.elevatedActions?.includes?.(action)
  ) {
    if (!context.mfaEnabled) {
      reasons.push('baseline_mfa_recommended');
    }
  }

  const required = reasons.some((reason) =>
    ['action_mandatory', 'high_risk_score', 'session_stale', 'device_untrusted', 'trusted_device_expired'].includes(
      reason,
    ),
  );

  const recommendedFactors = sortFactors(availableFactors, policy.preferredFactorsOrder);

  return {
    required,
    reasons,
    recommendedFactors,
  };
}

function normaliseFactors(factors) {
  if (!factors) return [];
  if (Array.isArray(factors)) return [...new Set(factors.map((factor) => `${factor}`.toLowerCase()))];
  if (factors instanceof Set) {
    return [...new Set([...factors].map((factor) => `${factor}`.toLowerCase()))];
  }
  return [];
}

function sortFactors(factors, preferredOrder = []) {
  if (!Array.isArray(factors)) return [];
  if (!Array.isArray(preferredOrder) || preferredOrder.length === 0) {
    return [...factors];
  }
  const orderMap = new Map(preferredOrder.map((factor, index) => [factor, index]));
  return [...factors].sort((a, b) => {
    const rankA = orderMap.has(a) ? orderMap.get(a) : preferredOrder.length + 1;
    const rankB = orderMap.has(b) ? orderMap.get(b) : preferredOrder.length + 1;
    return rankA - rankB || a.localeCompare(b);
  });
}

function minutesToMs(minutes) {
  return Math.round((minutes ?? 0) * 60 * 1000);
}

export const MFA_POLICY_DEFAULTS = DEFAULT_POLICY;
