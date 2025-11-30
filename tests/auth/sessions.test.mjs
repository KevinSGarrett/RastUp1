import test from 'node:test';
import assert from 'node:assert/strict';

import {
  issueSession,
  verifyRefreshToken,
  rotateSession,
  assertSessionActive,
  revokeSession
} from '../../services/auth/sessions.js';
import { AuthError, ERROR_CODES } from '../../services/auth/errors.js';

test('issueSession sets secure cookie descriptors', () => {
  const timestamp = 1764361200000; // 2025-11-29T03:00:00Z
  let seed = 1;
  const randomBytes = (size) => Buffer.alloc(size, seed++);

  const { session, tokens, cookies } = issueSession({
    userId: 'user-123',
    roles: ['admin'],
    deviceFingerprint: 'device-token',
    refreshPepper: 'refresh-secret',
    accessTokenSecret: 'access-secret',
    randomBytes,
    clock: () => timestamp,
    sessionLifetimeMs: 3600_000,
    idleTimeoutMs: 1_800_000,
    cookie: { domain: 'rastup.test', secure: true, sameSite: 'lax', path: '/' }
  });

  assert.equal(cookies.length, 3);
  const [accessCookie, refreshCookie, metaCookie] = cookies;
  assert.equal(accessCookie.name, 'access_token');
  assert.equal(refreshCookie.name, 'refresh_token');
  assert.equal(metaCookie.name, 'session_meta');

  for (const cookie of cookies) {
    assert.equal(cookie.attributes.httpOnly, cookie.name !== 'session_meta');
    assert.equal(cookie.attributes.secure, true);
    assert.equal(cookie.attributes.sameSite, 'lax');
    assert.equal(cookie.attributes.domain, 'rastup.test');
  }

  assert.equal(session.userId, 'user-123');
  assert.equal(session.status, 'active');
  assert.equal(typeof tokens.refreshToken, 'string');
  assert.equal(typeof tokens.accessToken, 'string');
});

test('rotateSession updates refresh hash and rejects old token', () => {
  const baseClock = () => 1764361200000;
  const first = issueSession({
    userId: 'user-456',
    roles: ['support'],
    refreshPepper: 'pepper',
    accessTokenSecret: 'secret',
    randomBytes: (size) => Buffer.alloc(size, 9),
    clock: baseClock
  });

  verifyRefreshToken(first.tokens.refreshToken, first.session, {
    refreshPepper: 'pepper',
    now: baseClock
  });

  const updatedSession = rotateSession(first.session, {
    refreshToken: 'new-refresh-token',
    refreshPepper: 'pepper',
    clock: () => baseClock() + 60000,
    randomBytes: (size) => Buffer.alloc(size, 5)
  });

  assert.notEqual(updatedSession.refreshHash, first.session.refreshHash);

  const success = verifyRefreshToken('new-refresh-token', updatedSession, {
    refreshPepper: 'pepper',
    now: () => baseClock() + 60000
  });
  assert.equal(success, true);

  assert.throws(
    () =>
      verifyRefreshToken(first.tokens.refreshToken, updatedSession, {
        refreshPepper: 'pepper',
        now: () => baseClock() + 60000
      }),
    (error) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, ERROR_CODES.SESSION_ROTATION_REQUIRED);
      return true;
    }
  );
});

test('revokeSession marks session inactive', () => {
  const { session } = issueSession({
    userId: 'user-789',
    roles: ['buyer'],
    refreshPepper: 'pepper',
    accessTokenSecret: 'secret'
  });

  const revoked = revokeSession(session, { reason: 'user_logout', clock: () => 1764361800000 });
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revokedReason, 'user_logout');
  assert.equal(revoked.revokedAt, new Date(1764361800000).toISOString());

  assert.throws(
    () => assertSessionActive(revoked),
    (error) => {
      assert.ok(error instanceof AuthError);
      assert.equal(error.code, ERROR_CODES.SESSION_REVOKED);
      return true;
    }
  );
});
