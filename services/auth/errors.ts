// services/auth/errors.ts
// Canonical Auth error helpers for the auth service.
//
// This module is intentionally self‑contained so we avoid
// circular aliasing between .ts and .js entrypoints.

export interface AuthErrorOptions {
  code: string;
  /**
   * Optional human-readable message. Defaults to the code.
   */
  message?: string;
  /**
   * HTTP status code to surface upstream (401/403/429/etc).
   * Defaults to 401 (unauthenticated) unless overridden by status map.
   */
  status?: number;
  /**
   * Optional underlying error/cause for logging.
   */
  cause?: unknown;
  /**
   * Extra structured data useful for logs / telemetry.
   */
  details?: Record<string, unknown>;
}

const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHORIZED: 403,
  RATE_LIMITED: 429,
  MFA_REQUIRED: 403,
  STEP_UP_REQUIRED: 403,
  ELEVATION_REQUIRED: 403,
  ELEVATION_EXPIRED: 403
};

function deriveStatus(code: string, fallback = 401): number {
  return STATUS_BY_CODE[code] ?? fallback;
}

/**
 * Domain-specific error type for authentication failures.
 */
export class AuthError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;
  public readonly cause?: unknown;

  constructor(options: AuthErrorOptions | string) {
    if (typeof options === "string") {
      super(options);
      this.name = "AuthError";
      this.code = options;
      this.status = deriveStatus(options);
      return;
    }

    const { code, message, status, cause, details } = options;
    super(message ?? code);

    this.name = "AuthError";
    this.code = code;
    this.status = status ?? deriveStatus(code);
    this.cause = cause;
    this.details = details;

    // Preserve proper stack traces in Node
    if (typeof (Error as { captureStackTrace?: Function }).captureStackTrace === "function") {
      (Error as { captureStackTrace?: Function }).captureStackTrace!(this, AuthError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details
    };
  }
}

/**
 * Flexible error code registry. We deliberately type this as
 * Record<string, string> so callers can use dot-properties like
 * ERROR_CODES.TOKEN_INVALID without TypeScript complaining,
 * even if we add more codes later.
 */
export const ERROR_CODES: Record<string, string> = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  PASSWORD_WEAK: "PASSWORD_WEAK",
  PASSWORD_COMPROMISED: "PASSWORD_COMPROMISED",
  TOKEN_INVALID: "TOKEN_INVALID",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_NONCE_MISMATCH: "TOKEN_NONCE_MISMATCH",
  TOKEN_AUDIENCE_MISMATCH: "TOKEN_AUDIENCE_MISMATCH",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  UNAUTHORIZED: "UNAUTHORIZED",
  RATE_LIMITED: "RATE_LIMITED",
  PROVIDER_MISCONFIGURED: "PROVIDER_MISCONFIGURED",
  SESSION_INVALID: "SESSION_INVALID",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_REVOKED: "SESSION_REVOKED",
  SESSION_ROTATION_REQUIRED: "SESSION_ROTATION_REQUIRED",
  MFA_REQUIRED: "MFA_REQUIRED",
  MFA_LOCKED: "MFA_LOCKED",
  MFA_INVALID_CODE: "MFA_INVALID_CODE",
  MFA_FACTOR_NOT_FOUND: "MFA_FACTOR_NOT_FOUND",
  MFA_ALREADY_ENROLLED: "MFA_ALREADY_ENROLLED",
  STEP_UP_REQUIRED: "STEP_UP_REQUIRED",
  ELEVATION_REQUIRED: "ELEVATION_REQUIRED",
  ELEVATION_EXPIRED: "ELEVATION_EXPIRED",
  DEVICE_UNTRUSTED: "DEVICE_UNTRUSTED",
  TOO_MANY_ATTEMPTS: "TOO_MANY_ATTEMPTS"
};

/**
 * Small invariant helper that throws an AuthError when a condition
 * does not hold. Useful in guards / route handlers.
 */
export function invariant(
  condition: unknown,
  code: string,
  message?: string,
  details?: Record<string, unknown>
): asserts condition {
  if (condition) return;

  throw new AuthError({
    code,
    message,
    details
  });
}

export function statusForCode(code: string, fallback?: number): number {
  return deriveStatus(code, fallback);
}
