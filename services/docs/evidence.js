import { createHash, timingSafeEqual } from 'node:crypto';
import { DocsError, assertDocs } from './errors.js';

function toBuffer(input) {
  if (input instanceof Uint8Array && !(input instanceof Buffer)) {
    return Buffer.from(input);
  }
  if (Buffer.isBuffer(input)) {
    return input;
  }
  if (typeof input === 'string') {
    return Buffer.from(input, 'utf-8');
  }
  throw new DocsError('DOC_HASH_INPUT_INVALID', 'Expected Buffer, Uint8Array, or string for hashing.', {
    type: typeof input
  });
}

function normalizeHex(value, { label }) {
  const hex = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new DocsError('DOC_HASH_INVALID', `${label} must be a valid hexadecimal string.`, {
      value
    });
  }
  return hex.toLowerCase();
}

export function computeSha256(input) {
  const buffer = toBuffer(input);
  return createHash('sha256').update(buffer).digest('hex');
}

export function isHashMatch(lhs, rhs) {
  if (!lhs || !rhs) {
    return false;
  }
  const leftHex = normalizeHex(lhs, { label: 'Expected hash' });
  const rightHex = normalizeHex(rhs, { label: 'Actual hash' });
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function assertHashEquality(expected, actual, { code = 'DOC_HASH_MISMATCH' } = {}) {
  assertDocs(expected, 'DOC_HASH_EXPECTED', 'Expected hash is required for comparison.');
  assertDocs(actual, 'DOC_HASH_ACTUAL', 'Actual hash is required for comparison.');
  if (!isHashMatch(expected, actual)) {
    throw new DocsError(code, 'Computed hash does not match expected hash.', {
      expected,
      actual
    });
  }
}

export function buildEvidenceRecord({
  docId,
  packId,
  preSignBuffer = null,
  postSignBuffer = null,
  storageUrl = null,
  nowIso = new Date().toISOString()
}) {
  assertDocs(docId, 'DOC_EVIDENCE_REQUIRED', 'docId is required to build evidence record.');
  assertDocs(packId, 'DOC_EVIDENCE_REQUIRED', 'packId is required to build evidence record.');
  const createdAt = nowIso;
  const renderPdfSha256Pre = preSignBuffer ? computeSha256(preSignBuffer) : null;
  const renderPdfSha256Post = postSignBuffer ? computeSha256(postSignBuffer) : null;
  return {
    docId,
    packId,
    renderPdfSha256Pre,
    renderPdfSha256Post,
    storageUrl,
    createdAt,
    verifiedAt: null,
    verificationStatus: 'pending',
    mismatchReason: null
  };
}

export function markEvidenceVerified(record, { postSignBuffer, nowIso = new Date().toISOString() }) {
  assertDocs(record, 'DOC_EVIDENCE_REQUIRED', 'Evidence record is required for verification.');
  assertDocs(record.renderPdfSha256Post, 'DOC_HASH_EXPECTED', 'Post-sign hash expected before verification.', {
    docId: record.docId
  });
  const computed = computeSha256(postSignBuffer);
  const match = isHashMatch(record.renderPdfSha256Post, computed);
  return {
    ...record,
    verificationStatus: match ? 'verified' : 'mismatch',
    mismatchReason: match ? null : 'post_sign_hash_mismatch',
    verifiedAt: nowIso,
    computedHash: computed
  };
}
