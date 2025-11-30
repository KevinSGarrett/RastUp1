export type PasswordHashAlgorithm = 'scrypt';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keyLength: number;
}

export interface PasswordHashRecord {
  algorithm: PasswordHashAlgorithm;
  hash: string;
  salt: string;
  pepperId?: string;
  params: ScryptParams;
  createdAt: string;
}

export interface PasswordEvaluation {
  valid: boolean;
  score: number;
  compromised: boolean;
  feedback: string[];
}

export interface BreachCheckResult {
  compromised: boolean;
  matchedCount?: number;
}

export interface VerifyPasswordOptions {
  pepper: string;
}

export interface SessionTokenPair {
  accessToken: string;
  refreshToken: string;
}

export type SessionCookieName = 'access_token' | 'refresh_token' | 'session_meta';

export interface SessionCookieDescriptor {
  name: SessionCookieName;
  value: string;
  attributes: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    path: string;
    domain?: string;
    maxAge?: number;
  };
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  deviceId: string;
  refreshHash: string;
  refreshSalt: string;
  refreshPepperId?: string;
  status: 'active' | 'revoked' | 'expired';
  issuedAt: string;
  rotatedAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  trustedDevice: boolean;
  riskScore: number;
  revokedAt?: string | null;
  revokedReason?: string | null;
}

export type DeviceTrustLevel = 'unknown' | 'trusted' | 'revoked';

export interface DeviceTrustRecord {
  deviceId: string;
  userId: string;
  trustLevel: DeviceTrustLevel;
  firstSeenAt: string;
  lastSeenAt: string;
  lastIp?: string;
  lastUserAgent?: string;
}

export type MfaFactorType = 'sms_otp' | 'totp' | 'webauthn';

export interface MfaFactorRecord {
  factorId: string;
  userId: string;
  type: MfaFactorType;
  status: 'pending' | 'active' | 'revoked';
  phoneE164?: string;
  secret?: string;
  backupCodes: string[];
  createdAt: string;
  lastVerifiedAt?: string;
}

export interface MfaChallengeRecord {
  challengeId: string;
  factorId: string;
  userId: string;
  type: MfaFactorType;
  sessionId?: string | null;
  issuedAt: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  codeHash: string;
  codeSalt: string;
}

export interface ElevationScope {
  action: string;
  resourceId?: string;
}

export interface ElevationRecord {
  elevationId: string;
  userId: string;
  grantedAt: string;
  expiresAt: string;
  scope: ElevationScope;
  factorId: string;
  sessionId: string;
}

export interface RbacContext {
  userId: string;
  roles: string[];
  sessionId: string;
  mfaVerifiedAt?: string;
  elevation?: ElevationRecord | null;
  trustedDevice: boolean;
  riskScore: number;
}

export interface AuthorizationDecision {
  allow: boolean;
  reason?: string;
  requiresMfa?: boolean;
  requiresElevation?: boolean;
  requiredRoles?: string[];
  elevationScope?: ElevationScope;
}

export interface IdTokenValidationInput {
  token: string;
  expectedAudience: string | string[];
  expectedIssuer: string | string[];
  nonce?: string;
  now?: () => number;
  jwks: Array<{
    kid: string;
    publicKeyPem: string;
  }>;
  maxAgeSeconds?: number;
}

export interface IdTokenPayload {
  iss: string;
  aud: string | string[];
  sub: string;
  email?: string;
  email_verified?: boolean;
  nonce?: string;
  exp: number;
  iat: number;
  auth_time?: number;
  [key: string]: unknown;
}
