import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createUploadManagerState,
  registerClientUpload,
  markUploadSigned,
  markUploadProgress,
  markUploadComplete,
  applyServerAttachmentStatus,
  markUploadFailed,
  cancelUpload,
  pruneUploads,
  getUpload,
  getUploadByAttachmentId
} from '../../../tools/frontend/messaging/upload_manager.mjs';

test('upload manager tracks lifecycle from register to ready', () => {
  const now = Date.parse('2025-11-19T09:00:00.000Z');
  let state = createUploadManagerState();
  state = registerClientUpload(
    state,
    {
      clientId: 'local-upload-1',
      fileName: 'moodboard.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 4_194_304,
      metadata: { threadId: 'thr-123' }
    },
    { now }
  );
  let item = getUpload(state, 'local-upload-1');
  assert.equal(item.status, 'REQUESTED');

  state = markUploadSigned(
    state,
    'local-upload-1',
    {
      attachmentId: 'att-1',
      uploadUrl: 'https://example.com/upload'
    },
    { now: now + 1_000 }
  );
  item = getUpload(state, 'local-upload-1');
  assert.equal(item.status, 'SIGNED');
  assert.equal(item.attachmentId, 'att-1');

  state = markUploadProgress(
    state,
    'local-upload-1',
    {
      uploadedBytes: 2_097_152,
      totalBytes: 4_194_304
    },
    { now: now + 2_000 }
  );
  item = getUpload(state, 'local-upload-1');
  assert.equal(item.status, 'UPLOADING');
  assert.equal(item.progress.uploadedBytes, 2_097_152);

  state = markUploadComplete(
    state,
    'local-upload-1',
    {
      checksum: 'abc123',
      attachmentId: 'att-1'
    },
    { now: now + 3_000 }
  );
  item = getUploadByAttachmentId(state, 'att-1');
  assert.equal(item.status, 'SCANNING');
  assert.equal(item.checksum, 'abc123');

  state = applyServerAttachmentStatus(
    state,
    {
      attachmentId: 'att-1',
      status: 'READY',
      nsfwBand: 1,
      metadata: { scanDurationMs: 4200 }
    },
    { now: now + 4_000 }
  );
  item = getUploadByAttachmentId(state, 'att-1');
  assert.equal(item.status, 'READY');
  assert.equal(item.nsfwBand, 1);
  assert.equal(item.metadata.scanDurationMs, 4200);
});

test('upload manager handles failures and cancellation', () => {
  let state = createUploadManagerState();
  state = registerClientUpload(
    state,
    {
      clientId: 'local-upload-2',
      fileName: 'proof.mp4',
      sizeBytes: 10_000_000
    },
    { now: 0 }
  );
  state = markUploadFailed(
    state,
    'local-upload-2',
    { errorCode: 'UPLOAD_TIMEOUT' },
    { now: 1000 }
  );
  let item = getUpload(state, 'local-upload-2');
  assert.equal(item.status, 'FAILED');
  assert.equal(item.errorCode, 'UPLOAD_TIMEOUT');

  state = cancelUpload(state, 'local-upload-2', { now: 2000 });
  item = getUpload(state, 'local-upload-2');
  assert.equal(item.status, 'CANCELLED');
});

test('pruneUploads removes terminal entries older than TTL', () => {
  const ttlMs = 5 * 60 * 1000;
  let state = createUploadManagerState({ ttlMs });
  state = registerClientUpload(
    state,
    {
      clientId: 'stale-upload',
      fileName: 'old.jpg'
    },
    { now: 0 }
  );
  state = markUploadFailed(state, 'stale-upload', { errorCode: 'NETWORK' }, { now: 1000 });
  state = pruneUploads(state, { now: ttlMs + 10_000 });
  assert.equal(getUpload(state, 'stale-upload'), null);
});
