import crypto from 'node:crypto';

import { AuthError, ERROR_CODES, invariant } from './errors.js';

const SUPPORTED_ALGS = new Set(['RS256']);

function base64UrlDecode(segment) {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function parseJwt(token) {
  invariant(typeof token === 'string', ERROR_CODES.TOKEN_INVALID, 'Token must be a string.');
  const parts = token.split('.');
  invariant(parts.length === 3, ERROR_CODES.TOKEN_INVALID, 'Token must contain three segments.');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const headerJson = base64UrlDecode(encodedHeader).toString('utf8');
  const payloadJson = base64UrlDecode(encodedPayload).toString('utf8');
  let header;
  let payload;
  try {
    header = JSON.parse(headerJson);
    payload = JSON.parse(payloadJson);
  } catch (error) {
    throw new AuthError({
      code: ERROR_CODES.TOKEN_INVALID,
      message: 'Unable to parse token JSON.',
      cause: error
    });
  }
  return {
    header,
    payload,
    signature: base64UrlDecode(encodedSignature),
    signingInput: `${encodedHeader}.${encodedPayload}`
  };
}

function selectKey(jwks, kid) {
  invariant(Array.isArray(jwks) && jwks.length > 0, ERROR_CODES.TOKEN_INVALID, 'JWKS must contain at least one key.');
  if (kid) {
    const match = jwks.find((key) => key.kid === kid);
    if (match) {
      return match;
    }
  }
  return jwks[0];
}

function verifySignature(signingInput, signature, publicKeyPem) {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(publicKeyPem, signature);
}

function ensureAudience(claimAud, expectedAudience) {
  const audiences = Array.isArray(claimAud) ? claimAud : [claimAud];
  const expected = Array.isArray(expectedAudience) ? expectedAudience : [expectedAudience];
  return expected.some((aud) => audiences.includes(aud));
}

function ensureIssuer(claimIss, expectedIssuer) {
  const expected = Array.isArray(expectedIssuer) ? expectedIssuer : [expectedIssuer];
  return expected.includes(claimIss);
}

/**
 * @param {import('./types').IdTokenValidationInput} input
 * @returns {import('./types').IdTokenPayload}
 */
export function validateIdToken(input) {
  const { token, expectedAudience, expectedIssuer, jwks, nonce, maxAgeSeconds } = input;
  const nowMs = input.now ? input.now() : Date.now();

  const parsed = parseJwt(token);
  const { header, payload, signature, signingInput } = parsed;

  invariant(SUPPORTED_ALGS.has(header.alg), ERROR_CODES.TOKEN_INVALID, 'Unsupported signing algorithm.', {
    algorithm: header.alg
  });

  const key = selectKey(jwks, header.kid);
  invariant(key?.publicKeyPem, ERROR_CODES.TOKEN_INVALID, 'JWKS entries must include `publicKeyPem`.');

  const signatureValid = verifySignature(signingInput, signature, key.publicKeyPem);
  invariant(signatureValid, ERROR_CODES.TOKEN_INVALID, 'Token signature verification failed.', { kid: key.kid });

  invariant(ensureIssuer(payload.iss, expectedIssuer), ERROR_CODES.TOKEN_INVALID, 'Issuer mismatch.', {
    issuer: payload.iss
  });
  invariant(ensureAudience(payload.aud, expectedAudience), ERROR_CODES.TOKEN_AUDIENCE_MISMATCH, 'Audience mismatch.', {
    aud: payload.aud
  });

  const nowSeconds = Math.floor(nowMs / 1000);
  invariant(typeof payload.exp === 'number', ERROR_CODES.TOKEN_INVALID, '`exp` claim missing.');
  invariant(payload.exp >= nowSeconds - 60, ERROR_CODES.TOKEN_EXPIRED, 'Token has expired.', {
    exp: payload.exp,
    now: nowSeconds
  });

  if (typeof payload.iat === 'number') {
    invariant(payload.iat <= nowSeconds + 120, ERROR_CODES.TOKEN_INVALID, 'Token issued in the future.', {
      iat: payload.iat
    });
  }

  if (maxAgeSeconds && typeof payload.auth_time === 'number') {
    invariant(payload.auth_time >= nowSeconds - maxAgeSeconds, ERROR_CODES.TOKEN_EXPIRED, 'Authentication age exceeded.', {
      auth_time: payload.auth_time,
      maxAgeSeconds
    });
  }

  if (nonce !== undefined) {
    invariant(payload.nonce === nonce, ERROR_CODES.TOKEN_NONCE_MISMATCH, 'Nonce mismatch.', {
      expected: nonce,
      actual: payload.nonce
    });
  }

  return payload;
}

/**
 * Validate a Google ID token using hosted JWKS.
 * @param {import('./types').IdTokenValidationInput & { hostedDomain?: string }} input
 */
export function validateGoogleIdToken(input) {
  const payload = validateIdToken({
    ...input,
    expectedIssuer: input.expectedIssuer ?? ['https://accounts.google.com', 'accounts.google.com']
  });
  if (input.hostedDomain) {
    invariant(payload.hd === input.hostedDomain, ERROR_CODES.TOKEN_INVALID, 'Hosted domain mismatch.', {
      hostedDomain: payload.hd
    });
  }
  if (payload.email && 'email_verified' in payload) {
    invariant(payload.email_verified === true, ERROR_CODES.TOKEN_INVALID, 'Email not verified.', {
      email: payload.email
    });
  }
  return payload;
}

/**
 * Validate an Apple Sign-In ID token.
 * @param {import('./types').IdTokenValidationInput} input
 */
export function validateAppleIdToken(input) {
  const payload = validateIdToken({
    ...input,
    expectedIssuer: input.expectedIssuer ?? 'https://appleid.apple.com'
  });
  if (payload.email && payload.email_verified !== undefined) {
    const verified = `${payload.email_verified}`.toLowerCase();
    invariant(verified === 'true', ERROR_CODES.TOKEN_INVALID, 'Apple email must be verified.', {
      email_verified: payload.email_verified
    });
  }
  return payload;
}

export const __testables = {
  base64UrlDecode,
  parseJwt,
  selectKey,
  verifySignature,
  ensureAudience,
  ensureIssuer
};
