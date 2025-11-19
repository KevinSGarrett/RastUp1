const DEFAULT_POLICY = {
  hardPatterns: [
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/i, // phone numbers
    /\b[A-Z0-9._%+-]+@(?:gmail|yahoo|outlook|icloud|protonmail)\.com\b/i,
    /\b(?:cashapp|venmo|paypal|zelle)\b/i,
    /\b(?:onlyfans|fansly)\.com\b/i
  ],
  softPatterns: [
    /\btext me\b/i,
    /\bcall me\b/i,
    /\boff-platform\b/i,
    /\bwire transfer\b/i,
    /\bdirect payment\b/i
  ],
  softEscalationLimit: 2,
  softEscalationWindowMs: 6 * 60 * 60 * 1000 // 6 hours
};

/**
 * Creates empty policy state.
 */
export function createPolicyState() {
  return {
    violations: []
  };
}

function normalizeOptions(options = {}) {
  return {
    hardPatterns: Array.isArray(options.hardPatterns) ? options.hardPatterns : DEFAULT_POLICY.hardPatterns,
    softPatterns: Array.isArray(options.softPatterns) ? options.softPatterns : DEFAULT_POLICY.softPatterns,
    softEscalationLimit:
      typeof options.softEscalationLimit === 'number' ? options.softEscalationLimit : DEFAULT_POLICY.softEscalationLimit,
    softEscalationWindowMs:
      typeof options.softEscalationWindowMs === 'number'
        ? options.softEscalationWindowMs
        : DEFAULT_POLICY.softEscalationWindowMs
  };
}

function testPatterns(text, patterns) {
  const matches = [];
  for (const pattern of patterns) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
    const match = text.match(regex);
    if (match) {
      matches.push({
        pattern: regex.source,
        match: match[0]
      });
    }
  }
  return matches;
}

function pruneViolations(violations, now, windowMs) {
  const cutoff = now - windowMs;
  return violations.filter((entry) => entry.timestamp >= cutoff);
}

/**
 * Evaluates a message body against anticircumvention policy.
 * @param {ReturnType<typeof createPolicyState>} state
 * @param {string} text
 * @param {{ now?: number } & Partial<typeof DEFAULT_POLICY>} options
 * @returns {{ status: 'ALLOW'|'NUDGE'|'BLOCK'; matches: Array<{pattern: string; match: string; severity: 'HARD'|'SOFT'}>; state: ReturnType<typeof createPolicyState> }}
 */
export function evaluateText(state, text, options = {}) {
  const opts = normalizeOptions(options);
  const now = options.now ?? Date.now();
  const baseState = state ?? createPolicyState();
  const normalizedText = (text ?? '').trim();

  if (normalizedText.length === 0) {
    return {
      status: 'ALLOW',
      matches: [],
      state: { ...baseState, violations: pruneViolations(baseState.violations, now, opts.softEscalationWindowMs) }
    };
  }

  const hardMatches = testPatterns(normalizedText, opts.hardPatterns).map((match) => ({
    ...match,
    severity: 'HARD'
  }));

  if (hardMatches.length > 0) {
    const updatedViolations = pruneViolations(baseState.violations, now, opts.softEscalationWindowMs);
    updatedViolations.push({ timestamp: now, severity: 'HARD' });
    return {
      status: 'BLOCK',
      matches: hardMatches,
      state: { ...baseState, violations: updatedViolations }
    };
  }

  const softMatches = testPatterns(normalizedText, opts.softPatterns).map((match) => ({
    ...match,
    severity: 'SOFT'
  }));

  const violations = pruneViolations(baseState.violations, now, opts.softEscalationWindowMs);

  if (softMatches.length > 0) {
    const softCount = violations.filter((entry) => entry.severity === 'SOFT').length + 1;
    violations.push({ timestamp: now, severity: 'SOFT' });
    if (softCount >= opts.softEscalationLimit) {
      return {
        status: 'BLOCK',
        matches: softMatches,
        state: { ...baseState, violations }
      };
    }
    return {
      status: 'NUDGE',
      matches: softMatches,
      state: { ...baseState, violations }
    };
  }

  return {
    status: 'ALLOW',
    matches: [],
    state: { ...baseState, violations }
  };
}

/**
 * Convenience helper combining evaluation with analytics payload.
 * @param {ReturnType<typeof createPolicyState>} state
 * @param {string} text
 * @param {{ threadId?: string; userId?: string; now?: number } & Partial<typeof DEFAULT_POLICY>} options
 */
export function evaluateWithAudit(state, text, options = {}) {
  const result = evaluateText(state, text, options);
  return {
    ...result,
    auditEvent:
      result.status === 'ALLOW'
        ? null
        : {
            type: 'messaging.policy.violation',
            payload: {
              status: result.status,
              matches: result.matches,
              threadId: options.threadId ?? null,
              userId: options.userId ?? null,
              timestamp: new Date(options.now ?? Date.now()).toISOString()
            }
          }
  };
}
