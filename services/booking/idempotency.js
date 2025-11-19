export class IdempotencyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IdempotencyError';
    this.code = code;
    this.details = details;
  }
}

function buildKey(scope, key) {
  if (typeof scope !== 'string' || scope.length === 0) {
    throw new IdempotencyError('SCOPE_REQUIRED', 'scope is required.', { scope });
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new IdempotencyError('KEY_REQUIRED', 'idempotency key is required.', { key });
  }
  return `${scope}:${key}`;
}

export function createIdempotencyStore(initialRecords = []) {
  const store = new Map();

  for (const record of initialRecords) {
    if (!record || !record.scope || !record.key) {
      continue;
    }
    const composite = buildKey(record.scope, record.key);
    store.set(composite, {
      status: record.status ?? 'consumed',
      response: record.response ?? null,
      expiresAt: record.expiresAt ? new Date(record.expiresAt).getTime() : null
    });
  }

  return {
    reserve(scope, key, { ttlMs = 5 * 60 * 1000, now = Date.now() } = {}) {
      const composite = buildKey(scope, key);
      const existing = store.get(composite);
      if (existing && existing.status === 'consumed' && (!existing.expiresAt || existing.expiresAt > now)) {
        throw new IdempotencyError('ALREADY_COMPLETED', 'Operation already completed for idempotency key.', {
          scope,
          key
        });
      }
      store.set(composite, { status: 'pending', response: null, expiresAt: now + ttlMs });
    },
    commit(scope, key, response, { now = Date.now() } = {}) {
      const composite = buildKey(scope, key);
      const record = store.get(composite);
      if (!record || record.status !== 'pending') {
        throw new IdempotencyError('RESERVATION_REQUIRED', 'Must reserve idempotency key before commit.', { scope, key });
      }
      store.set(composite, { status: 'consumed', response: response ?? null, expiresAt: now + 24 * 60 * 60 * 1000 });
      return store.get(composite);
    },
    get(scope, key, { now = Date.now() } = {}) {
      const composite = buildKey(scope, key);
      const record = store.get(composite);
      if (!record) {
        return null;
      }
      if (record.expiresAt && record.expiresAt < now && record.status !== 'consumed') {
        store.delete(composite);
        return null;
      }
      return record;
    },
    cleanup({ now = Date.now() } = {}) {
      for (const [composite, record] of store.entries()) {
        if (record.expiresAt && record.expiresAt < now && record.status !== 'consumed') {
          store.delete(composite);
        }
      }
    },
    snapshot() {
      const result = [];
      for (const [composite, record] of store.entries()) {
        const [scope, key] = composite.split(':');
        result.push({
          scope,
          key,
          status: record.status,
          response: record.response,
          expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : null
        });
      }
      return result;
    }
  };
}
