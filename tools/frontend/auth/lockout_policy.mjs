const DEFAULT_POLICY = Object.freeze({
  maxFailures: 5,
  windowMinutes: 15,
  lockoutMinutes: 15,
  captchaFailures: 3,
  captchaDurationMinutes: 30,
  riskCaptchaThreshold: 70,
  riskLockoutThreshold: 90,
});

/**
 * Registers a login attempt and returns the updated state alongside UI decisions.
 * State is designed to be serialisable (e.g. for localStorage or GraphQL mutations).
 *
 * @param {object} state - previous state snapshot
 * @param {object} attempt
 * @param {boolean} attempt.success
 * @param {number} [attempt.timestamp] - epoch ms; defaults to Date.now()
 * @param {number} [attempt.riskScore] - 0-100 scale
 * @param {string} [attempt.ip]
 * @param {object} [config]
 * @returns {{state: object, decision: {locked: boolean, lockedUntil: number|null, captchaRequired: boolean, captchaUntil: number|null, remainingAttempts: number}}}
 */
export function registerAttempt(state = {}, attempt = {}, config = DEFAULT_POLICY) {
  const now = typeof attempt.timestamp === 'number' ? attempt.timestamp : Date.now();
  const windowMs = minutesToMs(config.windowMinutes ?? 15);
  const lockoutMs = minutesToMs(config.lockoutMinutes ?? 15);
  const captchaMs = minutesToMs(config.captchaDurationMinutes ?? 30);

  const previousFailures = Array.isArray(state.failures) ? state.failures : [];
  const filteredFailures = previousFailures.filter((item) => now - item.timestamp <= windowMs);

  let lockedUntil =
    typeof state.lockedUntil === 'number' && state.lockedUntil > now ? state.lockedUntil : null;
  let captchaUntil =
    typeof state.captchaUntil === 'number' && state.captchaUntil > now ? state.captchaUntil : null;

  if (lockedUntil && attempt.success) {
    // successful login clears lockout
    lockedUntil = null;
  }

  let failures = filteredFailures;

  if (attempt.success) {
    failures = [];
    captchaUntil = null;
  } else {
    const failureRecord = {
      timestamp: now,
      ip: attempt.ip ?? null,
    };
    failures = [...filteredFailures, failureRecord];
  }

  const failureCount = failures.length;

  if (!attempt.success) {
    if (failureCount >= (config.maxFailures ?? 5)) {
      lockedUntil = now + lockoutMs;
    } else if (
      (config.riskLockoutThreshold ?? 90) <= (attempt.riskScore ?? 0)
    ) {
      lockedUntil = now + lockoutMs;
    }

    const shouldCaptcha =
      failureCount >= (config.captchaFailures ?? 3) ||
      (attempt.riskScore ?? 0) >= (config.riskCaptchaThreshold ?? 70);

    if (shouldCaptcha) {
      captchaUntil = now + captchaMs;
    }
  }

  const remainingAttempts = Math.max(0, (config.maxFailures ?? 5) - failureCount);

  const decision = {
    locked: Boolean(lockedUntil && lockedUntil > now),
    lockedUntil,
    captchaRequired: Boolean(captchaUntil && captchaUntil > now),
    captchaUntil,
    remainingAttempts,
  };

  return {
    state: {
      failures,
      lockedUntil,
      captchaUntil,
      lastAttemptAt: now,
    },
    decision,
  };
}

/**
 * Returns a human readable status string for UX messaging.
 * @param {object} decision
 * @param {number} [now]
 */
export function formatDecision(decision, now = Date.now()) {
  if (!decision) return 'ready';
  if (decision.locked) {
    const seconds = Math.max(0, Math.round((decision.lockedUntil - now) / 1000));
    return `locked:${seconds}`;
  }
  if (decision.captchaRequired) {
    return 'captcha';
  }
  return 'ready';
}

function minutesToMs(minutes) {
  return Math.round((minutes ?? 0) * 60 * 1000);
}

export const LOCKOUT_POLICY_DEFAULTS = DEFAULT_POLICY;
