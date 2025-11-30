import crypto from 'node:crypto';

import { hashPassword, verifyPassword } from './password.js';
import { AuthError, ERROR_CODES, invariant } from './errors.js';

const DEFAULT_SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const DEFAULT_IDLE_TIMEOUT_MS = 1000 * 60 * 30; // 30 minutes
const DEFAULT_REFRESH_BYTES = 48;

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function randomToken(bytes, randomBytes) {
  return base64UrlEncode(randomBytes(bytes));
}

function hashDeviceFingerprint(fingerprint) {
  return crypto.createHash('sha256').update(fingerprint, 'utf8').digest('hex');
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function signAccessToken(payload, secret, nowMs, expiresInSeconds = 900) {
  invariant(secret, ERROR_CODES.TOKEN_INVALID, 'Access token secret is required.');
  const header = { alg: 'HS512', typ: 'JWT' };
  const issued = Math.floor(nowMs / 1000);
  const exp = issued + expiresInSeconds;
  const body = { ...payload, iat: issued, exp };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(body)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha512', secret).update(signingInput).digest('base64url');
  return {
    token: `${signingInput}.${signature}`,
    exp,
    iat: issued
  };
}

function buildCookie(name, value, attributes) {
  return {
    name,
    value,
    attributes: {
      httpOnly: true,
      secure: attributes.secure ?? true,
      sameSite: attributes.sameSite ?? 'lax',
      path: attributes.path ?? '/',
      domain: attributes.domain,
      maxAge: attributes.maxAge
    }
  };
}

function buildMetaCookie(metadata, options) {
  const value = Buffer.from(JSON.stringify(metadata)).toString('base64url');
  return {
    name: 'session_meta',
    value,
    attributes: {
      httpOnly: false,
      secure: options.secure ?? true,
      sameSite: options.sameSite ?? 'lax',
      path: options.path ?? '/',
      domain: options.domain,
      maxAge: options.maxAge
    }
  };
}

/**
 * Issue a new session record + cookie descriptors.
 * @param {{
 *   userId: string;
 *   roles: string[];
 *   deviceFingerprint?: string;
 *   deviceId?: string;
 *   userAgent?: string;
 *   ipAddress?: string;
 *   trustedDevice?: boolean;
 *   riskScore?: number;
 *   refreshPepper: string;
 *   accessTokenSecret: string;
 *   randomBytes?: (size: number) => Uint8Array;
 *   clock?: () => number;
 *   sessionLifetimeMs?: number;
 *   idleTimeoutMs?: number;
 *   cookie?: { domain?: string; secure?: boolean; sameSite?: 'lax' | 'strict' | 'none'; path?: string; maxAgeSeconds?: number };
 * }} input
 */
export function issueSession(input) {
  const {
    userId,
    roles,
    deviceFingerprint,
    deviceId,
    userAgent,
    ipAddress,
    trustedDevice = false,
    riskScore = 0,
    refreshPepper,
    accessTokenSecret,
    randomBytes = (size) => crypto.randomBytes(size),
    clock = () => Date.now(),
    sessionLifetimeMs = DEFAULT_SESSION_LIFETIME_MS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    cookie = {}
  } = input;

  invariant(userId, ERROR_CODES.SESSION_INVALID, 'userId required for session issuance.');
  invariant(Array.isArray(roles) && roles.length > 0, ERROR_CODES.SESSION_INVALID, 'roles must be provided.');

  const sessionId = crypto.randomUUID();
  const deviceIdentifier = deviceId ?? (deviceFingerprint ? hashDeviceFingerprint(deviceFingerprint) : crypto.randomUUID());
  const refreshToken = randomToken(DEFAULT_REFRESH_BYTES, randomBytes);
  const refreshRecord = hashPassword(refreshToken, {
    pepper: refreshPepper,
    randomBytes,
    clock: () => nowIso(clock)
  });

  const nowMs = clock();
  const issuedAtIso = toIso(nowMs);
  const expiresAtMs = nowMs + sessionLifetimeMs;
  const idleExpiresAtMs = nowMs + idleTimeoutMs;

  const { token: accessToken, exp } = signAccessToken(
    {
      sid: sessionId,
      sub: userId,
      roles,
      td: trustedDevice,
      rs: Number(riskScore.toFixed(3))
    },
    accessTokenSecret,
    nowMs
  );

  const sessionRecord = {
    sessionId,
    userId,
    deviceId: deviceIdentifier,
    refreshHash: refreshRecord.hash,
    refreshSalt: refreshRecord.salt,
    refreshPepperId: refreshRecord.pepperId,
    status: 'active',
    issuedAt: issuedAtIso,
    rotatedAt: issuedAtIso,
    expiresAt: toIso(expiresAtMs),
    idleExpiresAt: toIso(idleExpiresAtMs),
    userAgent: userAgent ?? null,
    ipAddress: ipAddress ?? null,
    trustedDevice,
    riskScore
  };

  const cookieMaxAge = cookie.maxAgeSeconds ?? Math.floor(sessionLifetimeMs / 1000);

  const refreshCookie = buildCookie('refresh_token', refreshToken, {
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    domain: cookie.domain,
    maxAge: cookieMaxAge
  });

  const accessCookie = buildCookie('access_token', accessToken, {
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    domain: cookie.domain,
    maxAge: Math.floor((exp - Math.floor(nowMs / 1000)))
  });

  const metaCookie = buildMetaCookie(
    {
      sessionId,
      issuedAt: issuedAtIso,
      expiresAt: sessionRecord.expiresAt,
      idleExpiresAt: sessionRecord.idleExpiresAt,
      trustedDevice,
      riskScore
    },
    {
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      path: cookie.path,
      domain: cookie.domain,
      maxAge: cookieMaxAge
    }
  );

  return {
    session: sessionRecord,
    tokens: { accessToken, refreshToken },
    cookies: [accessCookie, refreshCookie, metaCookie]
  };
}

/**
 * Validates whether a session remains active.
 * @param {{ status: string; expiresAt: string; idleExpiresAt: string }} session
 * @param {{ now?: () => number }=} options
 */
export function assertSessionActive(session, options = {}) {
  const now = options.now ? options.now() : Date.now();
  invariant(session.status === 'active', ERROR_CODES.SESSION_REVOKED, 'Session has been revoked.', {
    status: session.status
  });
  const expiresAt = Date.parse(session.expiresAt);
  invariant(now <= expiresAt, ERROR_CODES.SESSION_EXPIRED, 'Session has expired.', {
    expiresAt: session.expiresAt
  });
  const idleExpires = Date.parse(session.idleExpiresAt);
  invariant(now <= idleExpires, ERROR_CODES.SESSION_EXPIRED, 'Session idle timeout exceeded.', {
    idleExpiresAt: session.idleExpiresAt
  });
}

/**
 * Rotates a session refresh token.
 * @param {SessionRecord} session
 * @param {{
 *   refreshToken: string;
 *   refreshPepper: string;
 *   randomBytes?: (size: number) => Uint8Array;
 *   clock?: () => number;
 *   idleTimeoutMs?: number;
 * }} input
 */
export function rotateSession(session, input) {
  const { refreshToken, refreshPepper, randomBytes = (size) => crypto.randomBytes(size), clock = () => Date.now(), idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = input;

  assertSessionActive(session, { now: clock });

  const newRecord = hashPassword(refreshToken, {
    pepper: refreshPepper,
    randomBytes,
    clock: () => nowIso(clock)
  });
  const nowIsoStr = toIso(clock());

  const updated = {
    ...session,
    refreshHash: newRecord.hash,
    refreshSalt: newRecord.salt,
    refreshPepperId: newRecord.pepperId,
    rotatedAt: nowIsoStr,
    idleExpiresAt: toIso(clock() + idleTimeoutMs)
  };

  return updated;
}

/**
 * Validates a presented refresh token against the stored record.
 * @param {string} refreshToken
 * @param {SessionRecord} session
 * @param {{ refreshPepper: string }} options
 */
export function verifyRefreshToken(refreshToken, session, options) {
  const nowFn = options?.now;
  assertSessionActive(session, { now: typeof nowFn === 'function' ? nowFn : undefined });
  const valid = verifyPassword(refreshToken, {
    hash: session.refreshHash,
    salt: session.refreshSalt,
    params: { N: 16384, r: 8, p: 1, keyLength: 64 }
  }, {
    pepper: options.refreshPepper
  });
  invariant(valid, ERROR_CODES.SESSION_ROTATION_REQUIRED, 'Refresh token invalid for session.', {
    sessionId: session.sessionId
  });
  return true;
}

/**
 * Touch a session to extend idle expiration without rotating refresh token.
 * @param {SessionRecord} session
 * @param {{ now?: () => number; idleTimeoutMs?: number }} options
 */
export function touchSession(session, options = {}) {
  const now = options.now ? options.now() : Date.now();
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const updatedIdle = toIso(now + idleTimeoutMs);
  return {
    ...session,
    idleExpiresAt: updatedIdle
  };
}

/**
 * Revoke a session and capture the reason.
 * @param {SessionRecord} session
 * @param {{ reason?: string; clock?: () => number }} options
 */
export function revokeSession(session, options = {}) {
  const clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
  return {
    ...session,
    status: 'revoked',
    revokedAt: toIso(clock()),
    revokedReason: options.reason ?? null
  };
}

export const __testables = {
  base64UrlEncode,
  randomToken,
  hashDeviceFingerprint,
  signAccessToken,
  buildCookie,
  buildMetaCookie
};
