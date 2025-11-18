import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, decodeCursor } from '../../services/search/pagination.js';

test('encodeCursor and decodeCursor round-trip with checksum', () => {
  const token = {
    page: 2,
    pageSize: 20,
    lastScore: 0.8123,
    personalizationKey: 'user123',
    checksum: ''
  };

  const encoded = encodeCursor(token);
  const decoded = decodeCursor(encoded);

  assert.equal(decoded.ok, true, 'cursor decodes successfully');
  assert.equal(decoded.value.page, token.page);
  assert.equal(decoded.value.pageSize, token.pageSize);
  assert.equal(decoded.value.lastScore, token.lastScore);
  assert.equal(decoded.value.personalizationKey, token.personalizationKey);
});

test('decodeCursor detects tampering', () => {
  const encoded = encodeCursor({ page: 1, pageSize: 20, checksum: '' });
  const tampered = encoded.replace(/.$/, (char) => (char === 'A' ? 'B' : 'A'));
  const decoded = decodeCursor(tampered);
  assert.equal(decoded.ok, false, 'tampered cursor rejected');
  assert.equal(decoded.error, 'CURSOR_INVALID_FORMAT', 'format error triggered');

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  payload.page = 3;
  const forged = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const forgedDecoded = decodeCursor(forged);
  assert.equal(forgedDecoded.ok, false, 'checksum mismatch rejected');
  assert.equal(forgedDecoded.error, 'CURSOR_CHECKSUM_MISMATCH');
});
