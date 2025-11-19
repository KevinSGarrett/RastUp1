import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSha256,
  isHashMatch,
  assertHashEquality,
  buildEvidenceRecord,
  markEvidenceVerified
} from '../../services/docs/evidence.js';
import { DocsError } from '../../services/docs/errors.js';

test('computeSha256 generates deterministic hashes and supports buffers', () => {
  const textHash = computeSha256('hello world');
  const bufferHash = computeSha256(Buffer.from('hello world'));
  assert.equal(textHash, bufferHash);
  assert.equal(textHash.length, 64);
});

test('isHashMatch performs constant-time comparison and rejects invalid hex', () => {
  const hash = computeSha256('contract');
  assert.ok(isHashMatch(hash, hash));
  assert.ok(!isHashMatch(hash, computeSha256('different')));
  assert.throws(() => isHashMatch(hash, 'zzzz'), (error) => error instanceof DocsError && error.code === 'DOC_HASH_INVALID');
});

test('assertHashEquality throws when hashes differ', () => {
  const hashA = computeSha256('A');
  const hashB = computeSha256('B');
  assert.doesNotThrow(() => assertHashEquality(hashA, hashA));
  assert.throws(
    () => assertHashEquality(hashA, hashB),
    (error) => error instanceof DocsError && error.code === 'DOC_HASH_MISMATCH'
  );
});

test('buildEvidenceRecord seeds hashes and markEvidenceVerified validates post-sign hash', () => {
  const record = buildEvidenceRecord({
    docId: 'doc_123',
    packId: 'dpk_123',
    preSignBuffer: Buffer.from('pdf-pre'),
    postSignBuffer: Buffer.from('pdf-post'),
    storageUrl: 's3://docs/prod/packs/doc_123.pdf',
    nowIso: '2025-11-19T10:20:00Z'
  });

  assert.equal(record.docId, 'doc_123');
  assert.ok(record.renderPdfSha256Pre);
  assert.ok(record.renderPdfSha256Post);
  assert.equal(record.verificationStatus, 'pending');

  const verified = markEvidenceVerified(record, {
    postSignBuffer: Buffer.from('pdf-post'),
    nowIso: '2025-11-19T10:21:00Z'
  });

  assert.equal(verified.verificationStatus, 'verified');
  assert.equal(verified.mismatchReason, null);

  const mismatched = markEvidenceVerified(record, {
    postSignBuffer: Buffer.from('tampered'),
    nowIso: '2025-11-19T10:22:00Z'
  });

  assert.equal(mismatched.verificationStatus, 'mismatch');
  assert.equal(mismatched.mismatchReason, 'post_sign_hash_mismatch');
});
