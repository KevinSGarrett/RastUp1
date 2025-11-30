import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword, evaluatePassword, __testables } from '../../services/auth/password.js';

test('hashPassword + verifyPassword round-trip with pepper', () => {
  let calls = 0;
  const fakeRandom = (size) => {
    calls += 1;
    return Buffer.alloc(size, calls);
  };

  const record = hashPassword('Sup3rSecure!', {
    pepper: 'pepper-secret',
    randomBytes: fakeRandom,
    clock: () => '2025-11-29T03:00:00Z'
  });

  assert.equal(record.algorithm, 'scrypt');
  assert.ok(record.hash.length > 0);
  assert.equal(record.pepperId.length, 16);
  assert.equal(record.createdAt, '2025-11-29T03:00:00Z');

  const verified = verifyPassword('Sup3rSecure!', record, { pepper: 'pepper-secret' });
  assert.equal(verified, true);

  const wrong = verifyPassword('Sup3rSecure?', record, { pepper: 'pepper-secret' });
  assert.equal(wrong, false);
});

test('evaluatePassword flags breached secrets via checker', async () => {
  const result = await evaluatePassword('Password123!', {
    breachChecker: async () => ({ compromised: true, matchedCount: 12 })
  });

  assert.equal(result.valid, false);
  assert.equal(result.compromised, true);
  assert.ok(result.feedback.some((msg) => msg.includes('breach')), 'breach feedback present');
});

test('internal helpers convert base64 correctly', () => {
  const { toBase64, fromBase64 } = __testables;
  const encoded = toBase64(Buffer.from('hello-world'));
  assert.equal(encoded, Buffer.from('hello-world').toString('base64'));
  assert.equal(fromBase64(encoded).toString(), 'hello-world');
});
