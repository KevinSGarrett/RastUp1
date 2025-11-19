const TERMINAL_STATUSES = new Set(['READY', 'QUARANTINED', 'FAILED', 'CANCELLED']);

function cloneState(state) {
  return {
    itemsByClientId: Object.fromEntries(
      Object.entries(state.itemsByClientId).map(([clientId, item]) => [clientId, { ...item }])
    ),
    itemsByAttachmentId: { ...state.itemsByAttachmentId },
    order: [...state.order],
    ttlMs: state.ttlMs,
    lastUpdatedAt: state.lastUpdatedAt
  };
}

function createUploadItem(descriptor, now) {
  return {
    clientId: descriptor.clientId,
    attachmentId: descriptor.attachmentId ?? null,
    fileName: descriptor.fileName ?? null,
    mimeType: descriptor.mimeType ?? null,
    sizeBytes: descriptor.sizeBytes ?? null,
    status: descriptor.status ?? 'REQUESTED',
    progress: {
      uploadedBytes: descriptor.progress?.uploadedBytes ?? 0,
      totalBytes: descriptor.progress?.totalBytes ?? descriptor.sizeBytes ?? 0
    },
    checksum: descriptor.checksum ?? null,
    uploadUrl: descriptor.uploadUrl ?? null,
    nsfwBand: descriptor.nsfwBand ?? null,
    safeModeState: descriptor.safeModeState ?? null,
    errorCode: descriptor.errorCode ?? null,
    metadata: { ...(descriptor.metadata ?? {}) },
    createdAt: descriptor.createdAt ?? new Date(now).toISOString(),
    updatedAt: descriptor.updatedAt ?? new Date(now).toISOString()
  };
}

/**
 * Creates an upload manager state tree.
 * @param {{ ttlMs?: number }} [options]
 */
export function createUploadManagerState(options = {}) {
  return {
    itemsByClientId: {},
    itemsByAttachmentId: {},
    order: [],
    ttlMs: typeof options.ttlMs === 'number' ? options.ttlMs : 60 * 60 * 1000, // 60 minutes
    lastUpdatedAt: Date.now()
  };
}

function ensureItem(state, clientId) {
  const item = state.itemsByClientId[clientId];
  if (!item) {
    throw new Error(`Unknown upload clientId: ${clientId}`);
  }
  return item;
}

function linkAttachmentId(state, item, attachmentId) {
  if (!attachmentId) {
    return;
  }
  if (item.attachmentId && item.attachmentId !== attachmentId) {
    delete state.itemsByAttachmentId[item.attachmentId];
  }
  item.attachmentId = attachmentId;
  state.itemsByAttachmentId[attachmentId] = item.clientId;
}

/**
 * Registers a client-side upload entry (prior to requesting a signed URL).
 * @param {ReturnType<typeof createUploadManagerState>} state
 * @param {{
 *   clientId: string;
 *   fileName?: string;
 *   mimeType?: string;
 *   sizeBytes?: number;
 *   metadata?: Record<string, any>;
 * }} descriptor
 * @param {{ now?: number }} [options]
 */
export function registerClientUpload(state, descriptor, options = {}) {
  if (!descriptor?.clientId) {
    throw new Error('registerClientUpload requires clientId');
  }
  const now = options.now ?? Date.now();
  const next = cloneState(state);
  const item = createUploadItem(
    {
      ...descriptor,
      status: 'REQUESTED'
    },
    now
  );
  next.itemsByClientId[item.clientId] = item;
  if (!next.order.includes(item.clientId)) {
    next.order.push(item.clientId);
  }
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Marks an upload as having received signed URL metadata.
 * @param {ReturnType<typeof createUploadManagerState>} state
 * @param {string} clientId
 * @param {{ attachmentId?: string; uploadUrl?: string; metadata?: Record<string, any> }} details
 * @param {{ now?: number }} [options]
 */
export function markUploadSigned(state, clientId, details = {}, options = {}) {
  const now = options.now ?? Date.now();
  const next = cloneState(state);
  const item = ensureItem(next, clientId);
  item.status = 'SIGNED';
  item.uploadUrl = details.uploadUrl ?? item.uploadUrl;
  item.metadata = { ...item.metadata, ...(details.metadata ?? {}) };
  item.updatedAt = new Date(now).toISOString();
  linkAttachmentId(next, item, details.attachmentId);
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Updates upload progress (moves status to UPLOADING).
 * @param {ReturnType<typeof createUploadManagerState>} state
 * @param {string} clientId
 * @param {{ uploadedBytes: number; totalBytes?: number }} progress
 * @param {{ now?: number }} [options]
 */
export function markUploadProgress(state, clientId, progress, options = {}) {
  const now = options.now ?? Date.now();
  const next = cloneState(state);
  const item = ensureItem(next, clientId);
  item.status = 'UPLOADING';
  item.progress = {
    uploadedBytes: progress.uploadedBytes,
    totalBytes: progress.totalBytes ?? item.progress.totalBytes ?? item.sizeBytes ?? progress.uploadedBytes
  };
  item.updatedAt = new Date(now).toISOString();
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Marks the upload as complete on the client (waiting for scanning).
 * @param {ReturnType<typeof createUploadManagerState>} state
 * @param {string} clientId
 * @param {{ attachmentId?: string; checksum?: string; metadata?: Record<string, any> }} [details]
 * @param {{ now?: number }} [options]
 */
export function markUploadComplete(state, clientId, details = {}, options = {}) {
  const now = options.now ?? Date.now();
  const next = cloneState(state);
  const item = ensureItem(next, clientId);
  item.status = 'SCANNING';
  item.checksum = details.checksum ?? item.checksum;
  item.metadata = { ...item.metadata, ...(details.metadata ?? {}) };
  item.updatedAt = new Date(now).toISOString();
  linkAttachmentId(next, item, details.attachmentId);
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Applies a server-side status update (e.g., SCANNING → READY/QUARANTINED).
 * @param {ReturnType<typeof createUploadManagerState>} state
 * @param {{
 *   attachmentId: string;
 *   status: 'SCANNING'|'READY'|'QUARANTINED'|'FAILED';
 *   nsfwBand?: number;
 *   safeModeState?: any;
 *   errorCode?: string;
 *   metadata?: Record<string, any>;
 * }} update
 * @param {{ now?: number }} [options]
 */
export function applyServerAttachmentStatus(state, update, options = {}) {
  if (!update?.attachmentId) {
    throw new Error('applyServerAttachmentStatus requires attachmentId');
  }
  const now = options.now ?? Date.now();
  const next = cloneState(state);
  const clientId = next.itemsByAttachmentId[update.attachmentId];
  if (!clientId) {
    // Unknown attachment; no-op.
    return state;
  }
  const item = ensureItem(next, clientId);
  item.status = update.status;
  item.nsfwBand = typeof update.nsfwBand === 'number' ? update.nsfwBand : item.nsfwBand;
  item.safeModeState = update.safeModeState ?? item.safeModeState;
  item.errorCode = update.errorCode ?? null;
  item.metadata = { ...item.metadata, ...(update.metadata ?? {}) };
  item.updatedAt = new Date(now).toISOString();
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Marks an upload as failed (client-side).
 * @param {ReturnType<typeof createUploadManagerState>} state
 * @param {string} clientId
 * @param {{ errorCode?: string; metadata?: Record<string, any> }} [details]
 * @param {{ now?: number }} [options]
 */
export function markUploadFailed(state, clientId, details = {}, options = {}) {
  const now = options.now ?? Date.now();
  const next = cloneState(state);
  const item = ensureItem(next, clientId);
  item.status = 'FAILED';
  item.errorCode = details.errorCode ?? 'UNKNOWN';
  item.metadata = { ...item.metadata, ...(details.metadata ?? {}) };
  item.updatedAt = new Date(now).toISOString();
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Cancels an upload (client abandoned).
 * @param {ReturnType<typeof createUploadManagerState>} state
 * @param {string} clientId
 * @param {{ now?: number }} [options]
 */
export function cancelUpload(state, clientId, options = {}) {
  const now = options.now ?? Date.now();
  const next = cloneState(state);
  const item = ensureItem(next, clientId);
  item.status = 'CANCELLED';
  item.updatedAt = new Date(now).toISOString();
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Removes terminal uploads that exceed TTL.
 * @param {ReturnType<typeof createUploadManagerState>} state
 * @param {{ now?: number; ttlMs?: number }} [options]
 */
export function pruneUploads(state, options = {}) {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? state.ttlMs;
  const cutoff = now - ttlMs;
  const next = cloneState(state);
  const remainingOrder = [];

  for (const clientId of next.order) {
    const item = next.itemsByClientId[clientId];
    if (!item) {
      continue;
    }
    const updatedTs = Date.parse(item.updatedAt ?? 0) || 0;
    if (TERMINAL_STATUSES.has(item.status) && updatedTs < cutoff) {
      delete next.itemsByClientId[clientId];
      if (item.attachmentId) {
        delete next.itemsByAttachmentId[item.attachmentId];
      }
      continue;
    }
    remainingOrder.push(clientId);
  }

  next.order = remainingOrder;
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Retrieves an upload entry by clientId.
 * @param {ReturnType<typeof createUploadManagerState>} state
 * @param {string} clientId
 */
export function getUpload(state, clientId) {
  return state.itemsByClientId[clientId] ?? null;
}

/**
 * Retrieves an upload entry by attachmentId.
 * @param {ReturnType<typeof createUploadManagerState>} state
 * @param {string} attachmentId
 */
export function getUploadByAttachmentId(state, attachmentId) {
  const clientId = state.itemsByAttachmentId[attachmentId];
  if (!clientId) {
    return null;
  }
  return getUpload(state, clientId);
}
