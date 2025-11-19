import {
  normalizeInboxPayload,
  normalizeThreadPayload,
  mapInboxEventEnvelope,
  mapThreadEventEnvelope
} from './normalizers.mjs';

function toIso(value, fallback = new Date(0).toISOString()) {
  if (typeof value === 'string' && value.trim()) {
    const ts = Date.parse(value);
    if (Number.isFinite(ts)) {
      return new Date(ts).toISOString();
    }
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return fallback;
}

function cloneAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }
  return attachments
    .filter((att) => att && typeof att === 'object')
    .map((att) => ({ ...att }));
}

function normalizeMessageAck(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const messageId = node.messageId ?? node.id ?? node.messageID ?? null;
  if (!messageId) {
    return null;
  }
  const authorUserId = node.authorUserId ?? node.author?.userId ?? node.author?.id ?? null;
  const typeRaw = node.type ?? node.messageType ?? node.kind ?? 'TEXT';
  const type = typeof typeRaw === 'string' ? typeRaw.toUpperCase() : 'TEXT';
  const action = node.action ?? node.actionCard ?? null;
  const nsfwBandRaw = node.nsfwBand ?? node.safeModeBand ?? node.nsfwLevel;
  const nsfwBand = Number.isInteger(nsfwBandRaw) ? nsfwBandRaw : 0;
  return {
    messageId: String(messageId),
    createdAt: toIso(node.createdAt ?? node.sentAt ?? node.timestamp ?? new Date()),
    authorUserId: authorUserId ? String(authorUserId) : null,
    type,
    body: typeof node.body === 'string' ? node.body : '',
    attachments: cloneAttachments(node.attachments ?? node.assets),
    action: action && typeof action === 'object' ? { ...action } : null,
    nsfwBand
  };
}

function defaultLogger() {
  return {
    debug() {},
    warn() {},
    error() {}
  };
}

function safeUnsubscribe(unsubscribeRef, clearFn) {
  if (typeof unsubscribeRef === 'function') {
    try {
      unsubscribeRef();
    } catch {
      // no-op
    }
  }
  clearFn?.();
}

/**
 * Creates a controller-aware client that orchestrates GraphQL fetches, subscriptions,
 * and optimistic mutations for messaging threads.
 * @param {{
 *   controller: ReturnType<typeof import('./controller.mjs').createMessagingController>;
 *   fetchInbox?: (args?: any) => Promise<any>;
 *   fetchThread?: (threadId: string, args?: any) => Promise<any>;
 *   subscribeInbox?: (handlers: { next: (envelope: any) => void; error?: (err: any) => void; complete?: () => void }) => () => void;
 *   subscribeThread?: (threadId: string, handlers: { next: (envelope: any) => void; error?: (err: any) => void; complete?: () => void }) => () => void;
 *   mutations?: {
 *     sendMessage?: (threadId: string, input: Record<string, any>) => Promise<any>;
 *     markThreadRead?: (threadId: string, ctx?: Record<string, any>) => Promise<any>;
 *     acceptMessageRequest?: (requestId: string, ctx?: Record<string, any>) => Promise<any>;
 *     declineMessageRequest?: (requestId: string, ctx?: Record<string, any>) => Promise<any>;
 *     recordConversationStart?: (ctx?: Record<string, any>) => Promise<any>;
 *   };
 *   logger?: { debug?: Function; warn?: Function; error?: Function };
 *   now?: () => number;
 * }} config
 */
export function createMessagingClient(config = {}) {
  const controller = config.controller;
  if (!controller || typeof controller.hydrateInbox !== 'function' || typeof controller.hydrateThread !== 'function') {
    throw new Error('createMessagingClient requires a messaging controller instance');
  }

  const fetchInbox = config.fetchInbox ?? null;
  const fetchThread = config.fetchThread ?? null;
  const subscribeInbox = config.subscribeInbox ?? null;
  const subscribeThread = config.subscribeThread ?? null;
  const mutations = config.mutations ?? {};
  const uploadHandlers = config.uploads ?? {};
  const logger = config.logger ?? defaultLogger();
  const nowFn = typeof config.now === 'function' ? config.now : () => Date.now();

  let inboxUnsubscribe = null;
  const threadSubscriptions = new Map();

  function ensureAttachmentId(baseId, provided) {
    if (provided && typeof provided === 'string') {
      return provided;
    }
    return `att_${baseId}`;
  }

  async function prepareUpload(threadId, descriptor = {}, optionsUpload = {}) {
    if (!threadId) {
      throw new Error('prepareUpload requires threadId');
    }
    const clientId =
      descriptor.clientId ??
      `upload_${nowFn().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const fileName = descriptor.fileName ?? descriptor.name ?? 'attachment';
    const mimeType = descriptor.mimeType ?? descriptor.type ?? 'application/octet-stream';
    const sizeBytes = descriptor.sizeBytes ?? descriptor.size ?? null;
    const metadata = { ...(descriptor.metadata ?? {}), threadId };

    const registerDescriptor = {
      clientId,
      fileName,
      mimeType,
      sizeBytes,
      metadata
    };
    if (descriptor.checksum) {
      registerDescriptor.checksum = descriptor.checksum;
    }

    controller.registerUpload(registerDescriptor, { now: optionsUpload.now ?? nowFn() });

    let attachmentId = descriptor.attachmentId ?? null;
    let sessionResult = null;

    try {
      if (typeof uploadHandlers.createUploadSession === 'function') {
        sessionResult = await uploadHandlers.createUploadSession(threadId, {
          ...registerDescriptor,
          file: descriptor.file ?? descriptor.blob ?? null,
          metadata
        });
        if (sessionResult) {
          attachmentId = ensureAttachmentId(clientId, sessionResult.attachmentId ?? attachmentId);
          controller.markUploadSigned(
            clientId,
            {
              attachmentId,
              uploadUrl: sessionResult.uploadUrl ?? null,
              metadata: sessionResult.metadata ?? {}
            },
            { now: nowFn() }
          );
        }
      } else {
        attachmentId = ensureAttachmentId(clientId, attachmentId);
        controller.markUploadSigned(
          clientId,
          { attachmentId },
          { now: nowFn() }
        );
      }

      if (
        sessionResult &&
        typeof uploadHandlers.performUpload === 'function' &&
        sessionResult.uploadUrl
      ) {
        await uploadHandlers.performUpload(sessionResult, {
          file: descriptor.file ?? descriptor.blob ?? null,
          onProgress: (progress) => {
            if (progress && typeof progress.uploadedBytes === 'number') {
              controller.markUploadProgress(
                clientId,
                {
                  uploadedBytes: progress.uploadedBytes,
                  totalBytes: progress.totalBytes ?? sizeBytes ?? progress.uploadedBytes
                },
                { now: nowFn() }
              );
            }
          }
        });
      } else if (descriptor.progress && typeof descriptor.progress.uploadedBytes === 'number') {
        controller.markUploadProgress(
          clientId,
          {
            uploadedBytes: descriptor.progress.uploadedBytes,
            totalBytes: descriptor.progress.totalBytes ?? sizeBytes ?? descriptor.progress.uploadedBytes
          },
          { now: nowFn() }
        );
      }

      controller.markUploadComplete(
        clientId,
        {
          attachmentId,
          checksum: descriptor.checksum ?? sessionResult?.checksum ?? null,
          metadata
        },
        { now: nowFn() }
      );

      if (typeof uploadHandlers.completeUpload === 'function') {
        const statusUpdate = await uploadHandlers.completeUpload(threadId, {
          clientId,
          attachmentId,
          metadata
        });
        if (statusUpdate) {
          controller.applyAttachmentStatus(
            {
              attachmentId,
              status: statusUpdate.status ?? 'READY',
              nsfwBand: statusUpdate.nsfwBand,
              safeModeState: statusUpdate.safeModeState,
              errorCode: statusUpdate.errorCode,
              metadata: statusUpdate.metadata
            },
            { now: nowFn() }
          );
        }
      } else {
        controller.applyAttachmentStatus(
          {
            attachmentId,
            status: 'READY'
          },
          { now: nowFn() }
        );
      }

      return controller.getUpload(clientId);
    } catch (error) {
      controller.markUploadFailed(
        clientId,
        { errorCode: error?.code ?? error?.name ?? 'UPLOAD_FAILED' },
        { now: nowFn() }
      );
      logger.error?.('messaging-client: prepareUpload failed', { error, threadId, clientId });
      throw error;
    }
  }

  async function refreshInbox(args) {
    if (typeof fetchInbox !== 'function') {
      throw new Error('fetchInbox is not configured for messaging client');
    }
    const payload = await fetchInbox(args);
    const normalized = normalizeInboxPayload(payload ?? {});
    controller.hydrateInbox(normalized);
    return normalized;
  }

  async function hydrateThread(threadId, args = {}) {
    if (!threadId) {
      throw new Error('hydrateThread requires threadId');
    }
    if (typeof fetchThread !== 'function') {
      throw new Error('fetchThread is not configured for messaging client');
    }
    const payload = await fetchThread(threadId, args);
    const normalized = normalizeThreadPayload(payload ?? {});
    if (normalized.thread.threadId !== threadId) {
      logger.warn?.('messaging-client: fetched threadId mismatch', {
        expected: threadId,
        received: normalized.thread.threadId
      });
    }
    controller.hydrateThread(normalized, { syncInbox: args.syncInbox !== false });
    if (args.subscribe) {
      startThreadSubscription(threadId, args.subscribeOptions);
    }
    return normalized;
  }

  function startInboxSubscription(options = {}) {
    if (inboxUnsubscribe) {
      return inboxUnsubscribe;
    }
    if (typeof subscribeInbox !== 'function') {
      throw new Error('subscribeInbox is not configured for messaging client');
    }
    const handlers = {
      next: (envelope) => {
        try {
          const event = mapInboxEventEnvelope(envelope);
          if (event) {
            controller.applyInboxEvent(event);
          }
        } catch (error) {
          logger.error?.('messaging-client: failed to apply inbox event', { error, envelope });
        }
      },
      error: (error) => {
        logger.error?.('messaging-client: inbox subscription error', { error });
        if (options.refreshOnError !== false && typeof fetchInbox === 'function') {
          refreshInbox().catch((refreshError) => {
            logger.error?.('messaging-client: failed to refresh inbox after error', { error: refreshError });
          });
        }
      },
      complete: () => {
        inboxUnsubscribe = null;
        logger.debug?.('messaging-client: inbox subscription completed');
      }
    };
    const unsubscribe = subscribeInbox(handlers);
    inboxUnsubscribe =
      typeof unsubscribe === 'function'
        ? () => {
            unsubscribe();
            inboxUnsubscribe = null;
          }
        : () => {
            inboxUnsubscribe = null;
          };
    return inboxUnsubscribe;
  }

  function stopInboxSubscription() {
    if (!inboxUnsubscribe) {
      return;
    }
    const current = inboxUnsubscribe;
    inboxUnsubscribe = null;
    safeUnsubscribe(current);
  }

  function startThreadSubscription(threadId, options = {}) {
    if (!threadId) {
      throw new Error('startThreadSubscription requires threadId');
    }
    if (threadSubscriptions.has(threadId)) {
      return threadSubscriptions.get(threadId);
    }
    if (typeof subscribeThread !== 'function') {
      throw new Error('subscribeThread is not configured for messaging client');
    }
    const handlers = {
      next: (envelope) => {
        try {
          const event = mapThreadEventEnvelope(envelope);
          if (event) {
            controller.applyThreadEvent(threadId, event);
          }
        } catch (error) {
          logger.error?.('messaging-client: failed to apply thread event', { error, threadId, envelope });
        }
      },
      error: (error) => {
        logger.error?.('messaging-client: thread subscription error', { error, threadId });
        if (options.refreshOnError !== false && typeof fetchThread === 'function') {
          hydrateThread(threadId, { syncInbox: options.syncInboxOnError }).catch((refreshError) => {
            logger.error?.('messaging-client: failed to rehydrate thread after error', {
              error: refreshError,
              threadId
            });
          });
        }
      },
      complete: () => {
        logger.debug?.('messaging-client: thread subscription completed', { threadId });
        threadSubscriptions.delete(threadId);
      }
    };
    const unsubscribe = subscribeThread(threadId, handlers);
    const wrapped =
      typeof unsubscribe === 'function'
        ? () => {
            unsubscribe();
            threadSubscriptions.delete(threadId);
          }
        : () => {
            threadSubscriptions.delete(threadId);
          };
    threadSubscriptions.set(threadId, wrapped);
    return wrapped;
  }

  function stopThreadSubscription(threadId) {
    const unsubscribe = threadSubscriptions.get(threadId);
    if (!unsubscribe) {
      return;
    }
    threadSubscriptions.delete(threadId);
    safeUnsubscribe(unsubscribe);
  }

  function dispose() {
    stopInboxSubscription();
    for (const [threadId, unsubscribe] of threadSubscriptions.entries()) {
      threadSubscriptions.delete(threadId);
      safeUnsubscribe(unsubscribe);
      logger.debug?.('messaging-client: disposed thread subscription', { threadId });
    }
  }

  async function sendMessage(threadId, input) {
    if (!threadId) {
      throw new Error('sendMessage requires threadId');
    }
    if (!input?.clientId) {
      throw new Error('sendMessage requires clientId in input');
    }
    if (typeof mutations.sendMessage !== 'function') {
      throw new Error('sendMessage mutation is not configured');
    }
    const authorUserId =
      input.authorUserId ?? (typeof controller.getViewerUserId === 'function' ? controller.getViewerUserId() : null);
    if (!authorUserId) {
      throw new Error('sendMessage requires authorUserId (input.authorUserId or controller viewer)');
    }
    const createdAt = input.createdAt ?? new Date(nowFn()).toISOString();
    controller.enqueueOptimisticMessage(threadId, {
      clientId: input.clientId,
      createdAt,
      authorUserId,
      body: input.body ?? '',
      type: input.type ?? 'TEXT',
      attachments: Array.isArray(input.attachments) ? input.attachments : []
    });
    try {
      const result = await mutations.sendMessage(threadId, input);
      const ack = normalizeMessageAck(result?.message ?? result);
      if (ack?.messageId) {
        controller.resolveOptimisticMessage(threadId, input.clientId, ack);
      }
      return ack ?? null;
    } catch (error) {
      const errorCode = error?.code ?? error?.extensions?.code ?? error?.name ?? 'UNKNOWN';
      controller.failOptimisticMessage(threadId, input.clientId, errorCode);
      logger.error?.('messaging-client: sendMessage mutation failed', { error, threadId, clientId: input.clientId });
      throw error;
    }
  }

  async function markThreadRead(threadId, ctx = {}) {
    if (!threadId) {
      throw new Error('markThreadRead requires threadId');
    }
    controller.markThreadRead(threadId, ctx);
    if (typeof mutations.markThreadRead !== 'function') {
      return;
    }
    try {
      await mutations.markThreadRead(threadId, ctx);
    } catch (error) {
      logger.error?.('messaging-client: markThreadRead mutation failed', { error, threadId });
      if (typeof fetchThread === 'function') {
        hydrateThread(threadId, { syncInbox: true }).catch((hydrateError) => {
          logger.warn?.('messaging-client: failed to rehydrate thread after markThreadRead failure', {
            error: hydrateError,
            threadId
          });
        });
      }
      throw error;
    }
  }

  async function acceptMessageRequest(requestId, ctx = {}) {
    if (!requestId) {
      throw new Error('acceptMessageRequest requires requestId');
    }
    controller.acceptMessageRequest(requestId, ctx);
    if (typeof mutations.acceptMessageRequest !== 'function') {
      return;
    }
    try {
      await mutations.acceptMessageRequest(requestId, ctx);
    } catch (error) {
      logger.error?.('messaging-client: acceptMessageRequest mutation failed', { error, requestId });
      if (typeof fetchInbox === 'function') {
        refreshInbox().catch((refreshError) => {
          logger.warn?.('messaging-client: failed to refresh inbox after request accept failure', {
            error: refreshError
          });
        });
      }
      throw error;
    }
  }

  async function declineMessageRequest(requestId, ctx = {}) {
    if (!requestId) {
      throw new Error('declineMessageRequest requires requestId');
    }
    controller.declineMessageRequest(requestId, ctx);
    if (typeof mutations.declineMessageRequest !== 'function') {
      return;
    }
    try {
      await mutations.declineMessageRequest(requestId, ctx);
    } catch (error) {
      logger.error?.('messaging-client: declineMessageRequest mutation failed', { error, requestId });
      if (typeof fetchInbox === 'function') {
        refreshInbox().catch((refreshError) => {
          logger.warn?.('messaging-client: failed to refresh inbox after request decline failure', {
            error: refreshError
          });
        });
      }
      throw error;
    }
  }

  async function recordConversationStart(ctx = {}) {
    controller.recordConversationStart({
      ...ctx,
      now: ctx.now ?? nowFn()
    });
    if (typeof mutations.recordConversationStart === 'function') {
      try {
        await mutations.recordConversationStart(ctx);
      } catch (error) {
        logger.error?.('messaging-client: recordConversationStart mutation failed', { error });
      }
    }
  }

  return {
    controller,
    refreshInbox,
    hydrateThread,
    startInboxSubscription,
    stopInboxSubscription,
    startThreadSubscription,
    stopThreadSubscription,
    dispose,
    prepareUpload,
    getUploadState: () =>
      (typeof controller.getUploadState === 'function' ? controller.getUploadState() : null),
    getUpload: (clientId) =>
      (typeof controller.getUpload === 'function' ? controller.getUpload(clientId) : null),
    cancelUpload: (clientId, options = {}) =>
      (typeof controller.cancelUpload === 'function' ? controller.cancelUpload(clientId, options) : null),
    applyAttachmentStatus: (update, options = {}) =>
      (typeof controller.applyAttachmentStatus === 'function'
        ? controller.applyAttachmentStatus(update, options)
        : null),
    markUploadFailed: (clientId, details = {}, options = {}) =>
      (typeof controller.markUploadFailed === 'function'
        ? controller.markUploadFailed(clientId, details, options)
        : null),
    sendMessage,
    markThreadRead,
    acceptMessageRequest,
    declineMessageRequest,
    recordConversationStart
  };
}
