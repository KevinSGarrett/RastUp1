import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdempotencyStore, IdempotencyError } from '../../services/booking/idempotency.js';

test('idempotency store reserves and commits keys', () => {
  const store = createIdempotencyStore();
  store.reserve('checkout', 'abc', { ttlMs: 1000, now: 0 });
  const pending = store.get('checkout', 'abc', { now: 500 });
  assert.equal(pending.status, 'pending');
  store.commit('checkout', 'abc', { ok: true }, { now: 500 });
  const committed = store.get('checkout', 'abc', { now: 1000 });
  assert.equal(committed.status, 'consumed');
  assert.deepEqual(committed.response, { ok: true });
});

test('idempotency store prevents duplicate completion', () => {
  const store = createIdempotencyStore([{ scope: 'checkout', key: 'dup', status: 'consumed' }]);
  assert.throws(
    () => store.reserve('checkout', 'dup'),
    (error) => error instanceof IdempotencyError && error.code === 'ALREADY_COMPLETED'
  );
});

test('cleanup removes expired pending entries', () => {
  const store = createIdempotencyStore([{ scope: 'scope', key: 'expired', status: 'pending', expiresAt: '2025-11-19T00:00:00Z' }]);
  store.cleanup({ now: new Date('2025-11-20T00:00:00Z').getTime() });
  assert.equal(store.get('scope', 'expired'), null);
});
