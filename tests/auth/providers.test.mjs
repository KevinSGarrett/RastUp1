import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { validateGoogleIdToken, validateAppleIdToken } from '../../services/auth/providers.js';
import { AuthError, ERROR_CODES } from '../../services/auth/errors.js';

function toBase64Url(input) {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
}

test('validateGoogleIdToken accepts valid RS256 token', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const header = { alg: 'RS256', kid: 'test-google-key', typ: 'JWT' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: 'client-123',
    sub: 'user-456',
    email: 'user@example.com',
    email_verified: true,
    iat: nowSeconds,
    exp: nowSeconds + 600,
    nonce: 'nonce-xyz'
  };

  const signingInput = `${toBase64Url(header)}.${toBase64Url(payload)}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).end().sign(privateKey).toString('base64url');
  const token = `${signingInput}.${signature}`;

  const result = validateGoogleIdToken({
    token,
    expectedAudience: 'client-123',
    nonce: 'nonce-xyz',
    jwks: [{ kid: 'test-google-key', publicKeyPem: publicKey }]
  });

  assert.equal(result.sub, 'user-456');
  assert.equal(result.email, 'user@example.com');
});

test('validateAppleIdToken rejects expired tokens', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const header = { alg: 'RS256', kid: 'apple-key', typ: 'JWT' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://appleid.apple.com',
    aud: 'bundle-id',
    sub: 'user-789',
    email: 'apple@example.com',
    email_verified: 'true',
    iat: nowSeconds - 7200,
    exp: nowSeconds - 60
  };

  const signingInput = `${toBase64Url(header)}.${toBase64Url(payload)}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).end().sign(privateKey).toString('base64url');
  const token = `${signingInput}.${signature}`;

  assert.throws(
    () =>
      validateAppleIdToken({
        token,
        expectedAudience: 'bundle-id',
        jwks: [{ kid: 'apple-key', publicKeyPem: publicKey }],
        now: () => (nowSeconds + 5) * 1000
      }),
    (error) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, ERROR_CODES.TOKEN_EXPIRED);
      return true;
    }
  );
});
