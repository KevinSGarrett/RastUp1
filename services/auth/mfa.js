import crypto from 'node:crypto';

import { ERROR_CODES, invariant } from './errors.js';

const DEFAULT_BACKUP_CODE_COUNT = 10;
const DEFAULT_BACKUP_CODE_BYTES = 5;
const DEFAULT_OTP_LENGTH = 6;
const DEFAULT_CHALLENGE_TTL_SECONDS = 300;
const DEFAULT_MAX_ATTEMPTS = 5;

function randomBytes(size) {
  return crypto.randomBytes(size);
}

function generateHex(bytes) {
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

function generateSalt(byteLength = 6, rng = randomBytes) {
  return generateHex(rng(byteLength));
}

function hashCode(code, salt, pepper = '') {
  const payload = `${code}:${salt}:${pepper}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateOtp(length = DEFAULT_OTP_LENGTH, rng = randomBytes) {
  const bytes = rng(length);
  let otp = '';
  for (let i = 0; i < length; i += 1) {
    otp += (bytes[i] % 10).toString(10);
  }
  return otp;
}

function nowIso(clock = () => Date.now()) {
  return new Date(clock()).toISOString();
}

export function normalizePhoneE164(raw, options = {}) {
  const defaultCountry = (options.defaultCountryCode ?? '+1').replace(/[^\d]/g, '');
  invariant(typeof raw === 'string' && raw.trim().length > 0, ERROR_CODES.INVALID_CREDENTIALS, 'Phone number is required.');

  const digits = raw.replace(/[^\d]/g, '');
  invariant(digits.length >= 8 && digits.length <= 15, ERROR_CODES.INVALID_CREDENTIALS, 'Phone number appears invalid.', {
    raw
  });

  if (raw.trim().startsWith('+')) {
    return `+${digits}`;
  }

  if (defaultCountry && !digits.startsWith(defaultCountry)) {
    return `+${defaultCountry}${digits}`;
  }

  return `+${digits}`;
}

export function generateBackupCodes(count = DEFAULT_BACKUP_CODE_COUNT, rng = randomBytes) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const code = generateHex(rng(DEFAULT_BACKUP_CODE_BYTES));
    codes.push(code);
  }
  return codes;
}

export function hashBackupCodes(codes, options = {}) {
  const pepper = options.pepper ?? '';
  const rng = options.randomBytes ?? randomBytes;
  return codes.map((code) => {
    const salt = generateSalt(6, rng);
    const digest = hashCode(code, salt, pepper);
    return `sha256:${salt}:${digest}`;
  });
}

export function verifyBackupCode(factor, code, options = {}) {
  const pepper = options.pepper ?? '';
  const hashed = factor.backupCodes ?? [];
  for (const value of hashed) {
    const [algo, salt, digest] = typeof value === 'string' ? value.split(':') : [];
    if (algo !== 'sha256' || !salt || !digest) {
      continue;
    }
    const candidate = hashCode(code, salt, pepper);
    if (timingSafeEqual(candidate, digest)) {
      return true;
    }
  }
  return false;
}

export function enrollSmsFactor(options) {
  const {
    userId,
    phoneNumber,
    randomBytes: rng = randomBytes,
    clock = () => Date.now(),
    backupCodeCount = DEFAULT_BACKUP_CODE_COUNT,
    backupCodePepper = ''
  } = options;

  invariant(userId, ERROR_CODES.MFA_FACTOR_NOT_FOUND, 'userId is required for MFA enrollment.');
  const phoneE164 = normalizePhoneE164(phoneNumber);
  const factorId = crypto.randomUUID();
  const createdAt = nowIso(clock);

  const plainCodes = generateBackupCodes(backupCodeCount, rng);
  const hashedCodes = hashBackupCodes(plainCodes, { pepper: backupCodePepper, randomBytes: rng });

  const factor = {
    factorId,
    userId,
    type: 'sms_otp',
    status: 'pending',
    phoneE164,
    secret: undefined,
    backupCodes: hashedCodes,
    createdAt,
    lastVerifiedAt: undefined
  };

  return {
    factor,
    backupCodes: plainCodes
  };
}

export function issueSmsChallenge(options) {
  const {
    factor,
    sessionId,
    randomBytes: rng = randomBytes,
    clock = () => Date.now(),
    ttlSeconds = DEFAULT_CHALLENGE_TTL_SECONDS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    codePepper = '',
    templateId = 'auth.sms.otp',
    messageFormatter
  } = options;

  invariant(factor && factor.type === 'sms_otp', ERROR_CODES.MFA_FACTOR_NOT_FOUND, 'SMS factor is required for challenges.');

  const code = generateOtp(DEFAULT_OTP_LENGTH, rng);
  const salt = generateSalt(6, rng);
  const digest = hashCode(code, salt, codePepper);
  const issuedAt = nowIso(clock);
  const expiresAt = nowIso(() => clock() + ttlSeconds * 1000);

  const challenge = {
    challengeId: crypto.randomUUID(),
    factorId: factor.factorId,
    userId: factor.userId,
    sessionId: sessionId ?? null,
    type: factor.type,
    issuedAt,
    expiresAt,
    attempts: 0,
    maxAttempts,
    codeHash: digest,
    codeSalt: salt
  };

  const sms = {
    to: factor.phoneE164,
    templateId,
    body: typeof messageFormatter === 'function'
      ? messageFormatter({ code, factor })
      : `Your verification code is ${code}.`
  };

  return {
    challenge,
    code,
    sms
  };
}

export function verifyChallenge(challenge, code, options = {}) {
  const clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
  const pepper = options.codePepper ?? '';
  const currentAttempts = challenge.attempts ?? 0;

  if (currentAttempts >= challenge.maxAttempts) {
    return {
      ok: false,
      status: 'locked',
      errorCode: ERROR_CODES.MFA_LOCKED,
      challenge
    };
  }

  const nowMs = clock();
  const expiresAtMs = Date.parse(challenge.expiresAt);
  if (!Number.isFinite(expiresAtMs) || nowMs > expiresAtMs) {
    return {
      ok: false,
      status: 'expired',
      errorCode: ERROR_CODES.MFA_INVALID_CODE,
      challenge: {
        ...challenge,
        attempts: currentAttempts + 1
      }
    };
  }

  const digest = hashCode(code, challenge.codeSalt, pepper);
  const success = timingSafeEqual(digest, challenge.codeHash);
  const attempts = currentAttempts + 1;
  if (!success) {
    const locked = attempts >= challenge.maxAttempts;
    return {
      ok: false,
      status: locked ? 'locked' : 'invalid',
      errorCode: locked ? ERROR_CODES.MFA_LOCKED : ERROR_CODES.MFA_INVALID_CODE,
      challenge: {
        ...challenge,
        attempts
      }
    };
  }

  return {
    ok: true,
    status: 'verified',
    challenge: {
      ...challenge,
      attempts
    }
  };
}

const STEP_UP_POLICIES = {
  'payments:payout.update': {
    force: true,
    factors: ['sms_otp', 'totp'],
    requireTrustedDevice: true,
    reason: 'payout_change'
  },
  'admin:elevation': {
    force: true,
    factors: ['sms_otp', 'totp'],
    reason: 'admin_elevation'
  },
  'account:email.update': {
    maxAgeMs: 15 * 60 * 1000,
    riskThreshold: 0.45,
    factors: ['sms_otp', 'totp'],
    reason: 'profile_change'
  }
};

export function requiresStepUp(action, context = {}, overrides = {}) {
  const policy = {
    maxAgeMs: overrides.maxAgeMs ?? 10 * 60 * 1000,
    riskThreshold: overrides.riskThreshold ?? 0.7,
    requireTrustedDevice: overrides.requireTrustedDevice ?? false,
    factors: overrides.factors,
    force: overrides.force ?? false,
    reason: overrides.reason,
    now: overrides.now ?? (() => Date.now()),
    ...STEP_UP_POLICIES[action]
  };

  let required = Boolean(policy.force);
  const reasons = [];

  if (policy.force) {
    reasons.push(policy.reason ?? 'forced');
  }

  const nowValue = typeof policy.now === 'function' ? policy.now() : policy.now;
  const lastVerifiedMs = context.mfaVerifiedAt ? Date.parse(context.mfaVerifiedAt) : null;
  if (
    policy.maxAgeMs !== undefined &&
    (lastVerifiedMs === null || Number.isNaN(lastVerifiedMs) || nowValue - lastVerifiedMs > policy.maxAgeMs)
  ) {
    required = true;
    reasons.push('stale_mfa');
  }

  if (policy.riskThreshold !== undefined && (context.riskScore ?? 0) >= policy.riskThreshold) {
    required = true;
    reasons.push('risk');
  }

  if (policy.requireTrustedDevice && !context.trustedDevice) {
    required = true;
    reasons.push('untrusted_device');
  }

  return {
    required,
    reasons,
    factors: required ? (policy.factors ?? ['sms_otp']) : [],
    policy
  };
}

export const __testables = {
  hashCode,
  timingSafeEqual,
  generateOtp,
  generateSalt
};
