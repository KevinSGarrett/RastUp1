import crypto from 'node:crypto';

import { AuthError, ERROR_CODES, invariant } from './errors.js';

const DEFAULT_SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64 });
const DEFAULT_SALT_LENGTH = 16;
const PEPPER_ID_HASH_ALGO = 'sha256';
const DEFAULT_PASSWORD_MIN_LENGTH = 12;

const COMMON_PASSWORDS = new Set([
  'password',
  '123456',
  'qwerty',
  'letmein',
  '111111',
  'abc123',
  'password1',
  'iloveyou'
]);

/**
 * @param {Uint8Array} buffer
 */
function toBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

/**
 * @param {string} base64
 */
function fromBase64(base64) {
  return Buffer.from(base64, 'base64');
}

/**
 * Generates a deterministic pepper identifier without exposing the secret value.
 * @param {string} pepper
 */
function derivePepperId(pepper) {
  return crypto.createHash(PEPPER_ID_HASH_ALGO).update(pepper, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Generates a cryptographically secure salt.
 * @param {number} length
 * @param {() => Uint8Array} randomBytes
 */
function generateSalt(length, randomBytes) {
  const bytes = randomBytes(length);
  return toBase64(bytes);
}

/**
 * Hash a password using scrypt with an optional pepper.
 * @param {string} password
 * @param {{
 *   pepper?: string;
 *   salt?: string;
 *   params?: typeof DEFAULT_SCRYPT_PARAMS;
 *   randomBytes?: (size: number) => Uint8Array;
 *   clock?: () => string;
 * }=} options
 */
export function hashPassword(password, options = {}) {
  invariant(typeof password === 'string' && password.length > 0, ERROR_CODES.PASSWORD_WEAK, 'Password must be a non-empty string.');

  const pepper = options.pepper ?? '';
  const params = { ...DEFAULT_SCRYPT_PARAMS, ...(options.params ?? {}) };
  const randomBytes = options.randomBytes ?? ((size) => crypto.randomBytes(size));
  const salt = options.salt ?? generateSalt(DEFAULT_SALT_LENGTH, randomBytes);
  const derivedKey = crypto.scryptSync(password + pepper, fromBase64(salt), params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p
  });

  return {
    algorithm: 'scrypt',
    hash: toBase64(derivedKey),
    salt,
    pepperId: pepper ? derivePepperId(pepper) : undefined,
    params,
    createdAt: options.clock ? options.clock() : new Date().toISOString()
  };
}

/**
 * Verifies a password against a stored hash record.
 * @param {string} password
 * @param {{
 *   hash: string;
 *   salt: string;
 *   params: typeof DEFAULT_SCRYPT_PARAMS;
 *   algorithm?: string;
 * }} record
 * @param {{ pepper?: string }=} options
 */
export function verifyPassword(password, record, options = {}) {
  invariant(record && typeof record.hash === 'string', ERROR_CODES.PASSWORD_WEAK, 'Invalid password hash record.');
  const pepper = options.pepper ?? '';
  const params = { ...DEFAULT_SCRYPT_PARAMS, ...(record.params ?? {}) };
  const derivedKey = crypto.scryptSync(password + pepper, fromBase64(record.salt), params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p
  });
  const candidate = toBase64(derivedKey);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(record.hash));
}

/**
 * Evaluate password strength and optionally run a breach check.
 * @param {string} password
 * @param {{
 *   minLength?: number;
 *   breachChecker?: (password: string) => Promise<{ compromised: boolean; matchedCount?: number }> | { compromised: boolean; matchedCount?: number };
 * }=} options
 * @returns {Promise<{
 *   valid: boolean;
 *   score: number;
 *   compromised: boolean;
 *   feedback: string[];
 * }>}
 */
export async function evaluatePassword(password, options = {}) {
  const minLength = options.minLength ?? DEFAULT_PASSWORD_MIN_LENGTH;
  const feedback = [];

  if (!password || typeof password !== 'string') {
    return {
      valid: false,
      score: 0,
      compromised: false,
      feedback: ['Password must be a string.']
    };
  }

  let score = 0;

  if (password.length >= minLength) {
    score += 40;
  } else {
    feedback.push(`Password must be at least ${minLength} characters.`);
  }

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  const complexityCount = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length;
  score += complexityCount * 10;

  if (complexityCount < 3) {
    feedback.push('Use a mix of upper, lower, digits, and symbols.');
  }

  if (/(.)\1{3,}/.test(password)) {
    feedback.push('Avoid repeated characters.');
    score -= 10;
  }

  if (/([a-zA-Z]{4,})/.test(password)) {
    const match = password.toLowerCase().match(/([a-z]{4,})/);
    if (match && COMMON_PASSWORDS.has(match[0])) {
      feedback.push('Password contains easily guessed words.');
      score -= 10;
    }
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    feedback.push('Password is too common.');
    score = Math.min(score, 20);
  }

  let compromised = false;
  if (options.breachChecker) {
    const result = await options.breachChecker(password);
    if (result?.compromised) {
      compromised = true;
      feedback.push('Password has been found in breach data. Choose a different one.');
      score = Math.min(score, 10);
    }
  }

  score = Math.max(Math.min(score, 100), 0);

  const valid = score >= 70 && !compromised && feedback.length === 0;

  return { valid, score, compromised, feedback };
}

/**
 * Determine whether a password hash record should be rotated based on age.
 * @param {{ createdAt: string }} record
 * @param {{ maxAgeDays?: number; now?: () => number }=} options
 */
export function needsRotation(record, options = {}) {
  if (!record?.createdAt) {
    return true;
  }
  const maxAgeDays = options.maxAgeDays ?? 365;
  const now = options.now ? options.now() : Date.now();
  const createdAt = Date.parse(record.createdAt);
  if (Number.isNaN(createdAt)) {
    return true;
  }
  const msElapsed = now - createdAt;
  return msElapsed > maxAgeDays * 24 * 60 * 60 * 1000;
}

export const __testables = {
  toBase64,
  fromBase64,
  derivePepperId,
  generateSalt
};
