const DEFAULT_CONFIG = Object.freeze({
  minLength: 12,
  maxLength: 128,
  requireClasses: {
    lowercase: true,
    uppercase: true,
    digit: true,
    symbol: true,
  },
  bannedPasswords: [
    'password',
    '123456',
    'qwerty',
    'letmein',
    'welcome1',
    '11111111',
    'password123',
    'iloveyou',
  ],
  dictionaryWords: [
    'password',
    'rastup',
    'creator',
    'studio',
    'booking',
    'welcome',
    'summer',
    'winter',
  ],
  maxRepeat: 4,
  breachThreshold: 1,
});

const CLASS_CHECKS = Object.freeze({
  lowercase: /[a-z]/,
  uppercase: /[A-Z]/,
  digit: /\d/,
  symbol: /[^A-Za-z0-9]/,
});

/**
 * Calculates a deterministic password score and requirement breakdown.
 * @param {string} password
 * @param {object} config
 * @returns {{total: number, breakdown: object, requirements: object, penalties: object}}
 */
export function calculatePasswordScore(password, config = DEFAULT_CONFIG) {
  const sanitized = `${password ?? ''}`.trim();
  const length = sanitized.length;
  const requirements = {};
  let varietyCount = 0;

  for (const [name, regex] of Object.entries(CLASS_CHECKS)) {
    const required = config.requireClasses?.[name];
    const present = regex.test(sanitized);
    requirements[name] = { required, present };
    if (present) varietyCount += 1;
  }

  const banned = config.bannedPasswords?.some((candidate) =>
    candidate && sanitized.toLowerCase() === candidate.toLowerCase(),
  );

  const dictionaryHit = config.dictionaryWords?.some((word) =>
    word && sanitized.toLowerCase().includes(word.toLowerCase()),
  );

  const repeatingSequencePenalty = hasRepeatingSequences(sanitized, config.maxRepeat ?? 4) ? 15 : 0;
  const casingPenalty = sanitized === sanitized.toLowerCase() || sanitized === sanitized.toUpperCase() ? 5 : 0;
  const dictionaryPenalty = dictionaryHit ? 25 : 0;
  const bannedPenalty = banned ? 100 : 0;

  const uniqueChars = new Set([...sanitized]).size;
  const entropyBonus = Math.min(uniqueChars * 2, 20);
  const lengthScore = Math.min(length, 24) * 2; // caps at 48
  const varietyScore = varietyCount * 12; // max 48

  const penalties = {
    repeatingSequencePenalty,
    casingPenalty,
    dictionaryPenalty,
    bannedPenalty,
  };

  const rawTotal =
    lengthScore +
    varietyScore +
    entropyBonus -
    (repeatingSequencePenalty + casingPenalty + dictionaryPenalty + bannedPenalty);

  const total = Math.max(0, Math.min(100, rawTotal));

  return {
    total,
    breakdown: {
      lengthScore,
      varietyScore,
      entropyBonus,
    },
    requirements,
    penalties,
    metadata: {
      length,
      uniqueChars,
      varietyCount,
      banned,
      dictionaryHit,
    },
  };
}

/**
 * Assess password including optional breach checker.
 * @param {string} password
 * @param {object} options
 * @param {(password: string) => Promise<{breached: boolean, occurrences?: number}>} [options.breachChecker]
 * @param {object} [options.config]
 * @returns {Promise<{valid: boolean, score: number, errors: string[], warnings: string[], breached: boolean, breakdown: object, penalties: object, requirements: object}>}
 */
export async function assessPassword(
  password,
  { breachChecker, config = DEFAULT_CONFIG } = {},
) {
  const score = calculatePasswordScore(password, config);
  const errors = [];
  const warnings = [];

  if (score.metadata.length < (config.minLength ?? 12)) {
    errors.push(`Password must be at least ${(config.minLength ?? 12)} characters long.`);
  }

  if (score.metadata.length > (config.maxLength ?? 128)) {
    errors.push(`Password must be fewer than ${(config.maxLength ?? 128)} characters.`);
  }

  for (const [name, detail] of Object.entries(score.requirements)) {
    if (detail.required && !detail.present) {
      errors.push(classRequirementCopy(name));
    }
  }

  if (score.penalties.bannedPenalty) {
    errors.push('Password appears on the banned list.');
  } else if (score.penalties.dictionaryPenalty) {
    warnings.push('Password contains common dictionary words.');
  }

  if (score.penalties.repeatingSequencePenalty) {
    warnings.push('Password contains repeating characters or predictable sequences.');
  }

  if (score.penalties.casingPenalty) {
    warnings.push('Password lacks casing variety.');
  }

  let breached = false;
  if (typeof breachChecker === 'function') {
    try {
      const result = await breachChecker(password);
      if (result?.breached) {
        breached = true;
        errors.push(
          result.occurrences
            ? `Password found in breach corpus (${result.occurrences} occurrences).`
            : 'Password found in breach corpus.',
        );
      }
    } catch (error) {
      warnings.push(`Breach check failed: ${error.message ?? 'unknown error'}`);
    }
  }

  const valid = errors.length === 0 && !breached;

  return {
    valid,
    score: score.total,
    errors,
    warnings,
    breached,
    breakdown: score.breakdown,
    penalties: score.penalties,
    requirements: score.requirements,
  };
}

function hasRepeatingSequences(value, maxRepeat = 4) {
  if (!value) return false;
  const limit = Math.max(2, maxRepeat);
  const regex = new RegExp(`(.)\\1{${limit - 1},}`);
  return regex.test(value);
}

function classRequirementCopy(name) {
  switch (name) {
    case 'lowercase':
      return 'Password must include at least one lowercase letter.';
    case 'uppercase':
      return 'Password must include at least one uppercase letter.';
    case 'digit':
      return 'Password must include at least one number.';
    case 'symbol':
      return 'Password must include at least one symbol.';
    default:
      return 'Password is missing required character classes.';
  }
}

export const PASSWORD_POLICY_DEFAULTS = DEFAULT_CONFIG;
