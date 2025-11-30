const STATUS_OVERRIDES = Object.freeze({
  UNAUTHORIZED: 403,
  RATE_LIMITED: 429,
  MFA_REQUIRED: 403,
  STEP_UP_REQUIRED: 403,
  ELEVATION_REQUIRED: 403,
  ELEVATION_EXPIRED: 403
});

const DEFAULT_STATUS = 401;

function deriveStatus(code, fallback = DEFAULT_STATUS) {
  if (!code) return fallback;
  return STATUS_OVERRIDES[code] ?? fallback;
}

export const ERROR_CODES = Object.freeze({
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PASSWORD_WEAK: 'PASSWORD_WEAK',
  PASSWORD_COMPROMISED: 'PASSWORD_COMPROMISED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_NONCE_MISMATCH: 'TOKEN_NONCE_MISMATCH',
  TOKEN_AUDIENCE_MISMATCH: 'TOKEN_AUDIENCE_MISMATCH',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_MISCONFIGURED: 'PROVIDER_MISCONFIGURED',
  SESSION_INVALID: 'SESSION_INVALID',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_ROTATION_REQUIRED: 'SESSION_ROTATION_REQUIRED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_LOCKED: 'MFA_LOCKED',
  MFA_INVALID_CODE: 'MFA_INVALID_CODE',
  MFA_FACTOR_NOT_FOUND: 'MFA_FACTOR_NOT_FOUND',
  MFA_ALREADY_ENROLLED: 'MFA_ALREADY_ENROLLED',
  STEP_UP_REQUIRED: 'STEP_UP_REQUIRED',
  ELEVATION_REQUIRED: 'ELEVATION_REQUIRED',
  ELEVATION_EXPIRED: 'ELEVATION_EXPIRED',
  DEVICE_UNTRUSTED: 'DEVICE_UNTRUSTED',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS'
});

export class AuthError extends Error {
  constructor(options) {
    if (typeof options === 'string') {
      super(options);
      this.name = 'AuthError';
      this.code = options;
      this.status = deriveStatus(options);
      return;
    }

    const { code, message, status, cause, details } = options ?? {};
    if (!code) {
      throw new TypeError('AuthError requires a code.');
    }

    super(message ?? code);
    this.name = 'AuthError';
    this.code = code;
    this.status = status ?? deriveStatus(code);
    if (cause !== undefined) {
      this.cause = cause;
    }
    if (details !== undefined) {
      this.details = details;
    }

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AuthError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details
    };
  }
}

export function invariant(condition, code, message, details) {
  if (condition) {
    return;
  }

  throw new AuthError({
    code,
    message,
    details
  });
}

export function statusForCode(code) {
  return deriveStatus(code);
}
