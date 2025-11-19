import {
  createInboxState,
  applyInboxEvent as applyInboxEventReducer,
  selectThreads,
  getTotalUnread,
  canStartConversation,
  recordConversationStart as recordConversationStartReducer,
  acceptMessageRequest as acceptMessageRequestReducer,
  declineMessageRequest as declineMessageRequestReducer,
  pruneExpiredRequests as pruneExpiredRequestsReducer
} from './inbox_store.mjs';
import {
  createThreadState,
  applyThreadEvent as applyThreadEventReducer,
  enqueueOptimisticMessage as enqueueOptimisticMessageReducer,
  resolveOptimisticMessage as resolveOptimisticMessageReducer,
  failOptimisticMessage as failOptimisticMessageReducer,
  getUnreadMessageIds,
  getActionCards,
  getActionCardTransitions,
  applyActionCardIntent as applyActionCardIntentReducer,
  getThreadModeration
} from './thread_store.mjs';
import {
  createNotificationQueue,
  enqueueNotification as enqueueNotificationReducer,
  flushNotifications as flushNotificationQueue,
  collectDigest as collectNotificationDigestReducer,
  listPendingNotifications
} from './notification_queue.mjs';
import {
  createModerationQueue,
  enqueueCase as enqueueModerationCase,
  updateCase as updateModerationCase,
  submitDecision as submitModerationDecisionState,
  resolveCase as resolveModerationCase,
  removeCase as removeModerationCase,
  getCase as getModerationCaseFromState,
  selectCases as selectModerationCases,
  getQueueStats as getModerationQueueStats,
  getPendingCases as getPendingModerationCases
} from './moderation_queue.mjs';
import {
  createUploadManagerState,
  registerClientUpload,
  markUploadSigned as markUploadSignedState,
  markUploadProgress as markUploadProgressState,
  markUploadComplete as markUploadCompleteState,
  applyServerAttachmentStatus,
  markUploadFailed as markUploadFailedState,
  cancelUpload as cancelUploadState,
  pruneUploads as pruneUploadsState,
  getUpload,
  getUploadByAttachmentId
} from './upload_manager.mjs';

function cloneNotificationState(state) {
  return {
    itemsById: Object.fromEntries(Object.entries(state.itemsById).map(([id, item]) => [id, { ...item }])),
    order: [...state.order],
    dedupe: { ...state.dedupe },
    quietHours: {
      startMinutes: state.quietHours.startMinutes,
      endMinutes: state.quietHours.endMinutes,
      timezoneOffsetMinutes: state.quietHours.timezoneOffsetMinutes,
      bypassSeverities: new Set(state.quietHours.bypassSeverities)
    },
    dedupeWindowMs: state.dedupeWindowMs,
    digestWindowMs: state.digestWindowMs,
    maxItems: state.maxItems,
    lastUpdatedAt: state.lastUpdatedAt
  };
}

function mapThreadEventToInbox(event, nextThreadState, viewerUserId) {
  if (!event?.type || !nextThreadState) {
    return null;
  }
  const threadId = nextThreadState.thread.threadId;
    switch (event.type) {
      case 'MESSAGE_CREATED': {
        const incrementUnread =
          event.payload?.authorUserId && viewerUserId && event.payload.authorUserId !== viewerUserId ? 1 : 0;
        const lastMessageAt = nextThreadState.thread.lastMessageAt ?? event.payload?.createdAt;
        return {
          type: 'THREAD_MESSAGE_RECEIVED',
          payload: {
            threadId,
            lastMessageAt,
            incrementUnread
          }
        };
      }
      case 'MESSAGE_UPDATED':
        return {
          type: 'THREAD_UPDATED',
          payload: {
            threadId,
            lastMessageAt: nextThreadState.thread.lastMessageAt
          }
        };
      case 'THREAD_STATUS_CHANGED':
        return {
          type: 'THREAD_UPDATED',
          payload: {
            threadId,
            status: nextThreadState.thread.status
          }
        };
      case 'THREAD_MODERATION_UPDATED': {
        const moderation = getThreadModeration(nextThreadState);
        const blocked =
          event.payload?.blocked ??
          event.payload?.moderation?.blocked ??
          Boolean(moderation?.blocked);
        const basePayload = {
          threadId,
          status: nextThreadState.thread.status,
          moderation
        };
        if (blocked === true) {
          return {
            type: 'THREAD_BLOCKED',
            payload: basePayload
          };
        }
        if (blocked === false) {
          return {
            type: 'THREAD_UNBLOCKED',
            payload: basePayload
          };
        }
        return {
          type: 'THREAD_UPDATED',
          payload: basePayload
        };
      }
      case 'SAFE_MODE_OVERRIDE':
        return {
          type: 'THREAD_UPDATED',
          payload: {
            threadId,
            safeModeRequired: nextThreadState.thread.safeModeRequired
          }
        };
      case 'READ_RECEIPT_UPDATED': {
        if (viewerUserId && event.payload?.userId === viewerUserId) {
          return {
            type: 'THREAD_READ',
            payload: { threadId }
          };
        }
        return null;
      }
      default:
        return null;
    }
}

/**
 * Creates a messaging controller that orchestrates inbox, thread, and notification state.
 * Provides a framework-neutral surface suitable for React, Vue, or other UI environments.
 * @param {{
 *   viewerUserId?: string|null;
 *   inbox?: Parameters<typeof createInboxState>[0];
 *   threads?: Array<Parameters<typeof createThreadState>[0]>;
 *   notifications?: Parameters<typeof createNotificationQueue>[0];
 *   now?: () => number;
 *   logger?: { debug?: Function; warn?: Function; error?: Function };
 *   onAnalyticsEvent?: (event: { type: string; payload?: Record<string, any> }) => void;
 * }} [options]
 */
export function createMessagingController(options = {}) {
  let viewerUserId = options.viewerUserId ?? null;
  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
  const logger = options.logger ?? null;
  const analytics = typeof options.onAnalyticsEvent === 'function' ? options.onAnalyticsEvent : null;
  const isoNow = () => new Date(nowFn()).toISOString();
  const toIsoInput = (value) => {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : isoNow();
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString();
      }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    return isoNow();
  };
  const randomId = (prefix) => `${prefix}-${nowFn().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const uploadOptions =
    options.uploads && typeof options.uploads === 'object' ? { ...options.uploads } : {};
  let uploadState = createUploadManagerState(uploadOptions);

  let inboxState = createInboxState(options.inbox ?? {});
  const threadStates = new Map();
  if (Array.isArray(options.threads)) {
    for (const threadInput of options.threads) {
      try {
        const state = createThreadState(threadInput);
        threadStates.set(state.thread.threadId, state);
      } catch (error) {
        if (logger?.warn) {
          logger.warn('messaging-controller: failed to hydrate thread', { error, threadInput });
        }
      }
    }
  }
  let notificationState = createNotificationQueue(options.notifications ?? {});
  let moderationQueueState = createModerationQueue(options.moderationQueue ?? {});

  const listeners = new Set();

  function getSnapshot() {
    return {
      inbox: inboxState,
      threads: threadStates,
      notifications: notificationState,
      uploads: uploadState,
      moderationQueue: moderationQueueState,
      viewerUserId
    };
  }

  function emit(changes) {
    if (!Array.isArray(changes) || changes.length === 0) {
      return;
    }
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      if (typeof listener !== 'function') continue;
      try {
        listener(changes, snapshot);
      } catch (error) {
        if (logger?.error) {
          logger.error('messaging-controller: listener threw', { error });
        }
      }
    }
  }

    function updateInbox(updater, change, changes) {
      const next = updater(inboxState);
      if (next === inboxState) {
        return false;
      }
      inboxState = next;
      if (change) {
        changes.push({ scope: 'inbox', ...change });
      }
      return true;
    }

    function updateNotifications(updater, change, changes) {
      const next = updater(notificationState);
      if (next === notificationState) {
        return false;
      }
      notificationState = next;
      if (change) {
        changes.push({ scope: 'notifications', ...change });
      }
      return true;
    }

    function updateUploads(updater, changes) {
      const result = updater(uploadState);
      if (!result || typeof result !== 'object') {
        return false;
      }
      const next = result.state ?? uploadState;
      if (next === uploadState) {
        return false;
      }
      uploadState = next;
      if (result.change) {
        changes.push({ scope: 'uploads', ...result.change });
      }
      return true;
    }

    function updateModerationQueue(updater, change, changes) {
      const next = updater(moderationQueueState);
      if (next === moderationQueueState) {
        return false;
      }
      moderationQueueState = next;
      if (change) {
        changes.push({ scope: 'moderationQueue', ...change });
      }
      return true;
    }

  function updateThread(threadId, updater, change, changes) {
    const current = threadStates.get(threadId);
    if (!current) {
      if (logger?.warn) {
        logger.warn('messaging-controller: missing thread', { threadId, reason: change?.action ?? 'update' });
      }
      return null;
    }
    const next = updater(current);
    if (next === current) {
      return current;
    }
    threadStates.set(threadId, next);
    if (change) {
      changes.push({ scope: 'thread', threadId, ...change });
    }
    return next;
  }

  function applyThreadEventInternal(threadId, event, options = {}) {
    const changes = [];
    const next = updateThread(
      threadId,
      (state) => applyThreadEventReducer(state, event),
      { action: 'event', event },
      changes
    );
    if (!next) {
      return null;
    }
    if (!options.skipInbox) {
      const inboxEvent = mapThreadEventToInbox(event, next, viewerUserId);
      if (inboxEvent) {
        updateInbox(
          (state) => applyInboxEventReducer(state, inboxEvent),
          { action: 'sync', event: inboxEvent, threadId },
          changes
        );
      }
    }
    if (changes.length) {
      emit(changes);
    }
    return next;
  }

  function hydrateInbox(inboxInput) {
    const changes = [];
    updateInbox(
      () => createInboxState(inboxInput ?? {}),
      { action: 'hydrate' },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return inboxState;
  }

  function applyInboxEvent(event) {
    const changes = [];
    updateInbox(
      (state) => applyInboxEventReducer(state, event),
      { action: 'event', event },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return inboxState;
  }

  function hydrateThread(threadInput, optionsHydrate = {}) {
    if (!threadInput?.thread?.threadId) {
      throw new Error('hydrateThread requires thread.threadId');
    }
    const state = createThreadState(threadInput);
    threadStates.set(state.thread.threadId, state);
    const changes = [
      { scope: 'thread', threadId: state.thread.threadId, action: 'hydrate' }
    ];
    if (optionsHydrate.syncInbox !== false) {
      updateInbox(
        (stateInbox) =>
          applyInboxEventReducer(stateInbox, {
            type: 'THREAD_UPDATED',
            payload: {
              threadId: state.thread.threadId,
              lastMessageAt: state.thread.lastMessageAt,
              status: state.thread.status,
              kind: state.thread.kind,
              safeModeRequired: state.thread.safeModeRequired
            }
          }),
        { action: 'sync', reason: 'hydrateThread', threadId: state.thread.threadId },
        changes
      );
    }
    emit(changes);
    return state;
  }

  function removeThread(threadId) {
    if (!threadStates.has(threadId)) {
      return false;
    }
    threadStates.delete(threadId);
    emit([{ scope: 'thread', threadId, action: 'remove' }]);
    return true;
  }

  function markThreadRead(threadId, payload = {}) {
    const userId = payload.userId ?? viewerUserId;
    if (!userId) {
      throw new Error('markThreadRead requires userId or viewerUserId');
    }
    const readAtIso = payload.readAt ?? new Date(nowFn()).toISOString();
    return applyThreadEventInternal(
      threadId,
      {
        type: 'READ_RECEIPT_UPDATED',
        payload: {
          userId,
          role: payload.role ?? 'participant',
          lastReadMsgId: payload.lastReadMsgId ?? null,
          lastReadAt: readAtIso
        }
      },
      { reason: 'markThreadRead' }
    );
  }

  function enqueueOptimisticMessage(threadId, input) {
    const changes = [];
    const createdAt = input?.createdAt ?? new Date(nowFn()).toISOString();
    const next = updateThread(
      threadId,
      (state) =>
        enqueueOptimisticMessageReducer(state, {
          ...input,
          createdAt
        }),
      { action: 'optimistic', clientId: input?.clientId },
      changes
    );
    if (!next) {
      return null;
    }
    updateInbox(
      (state) =>
        applyInboxEventReducer(state, {
          type: 'THREAD_MESSAGE_RECEIVED',
          payload: {
            threadId,
            lastMessageAt: next.thread.lastMessageAt ?? createdAt,
            incrementUnread: 0
          }
        }),
      { action: 'sync', event: { type: 'THREAD_MESSAGE_RECEIVED', origin: 'optimistic' }, threadId },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return next;
  }

  function resolveOptimisticMessage(threadId, clientId, payload) {
    const changes = [];
    const next = updateThread(
      threadId,
      (state) => resolveOptimisticMessageReducer(state, clientId, payload),
      { action: 'optimisticResolve', clientId, messageId: payload?.messageId },
      changes
    );
    if (!next) {
      return null;
    }
    updateInbox(
      (state) =>
        applyInboxEventReducer(state, {
          type: 'THREAD_UPDATED',
          payload: {
            threadId,
            lastMessageAt: next.thread.lastMessageAt
          }
        }),
      { action: 'sync', event: { type: 'THREAD_UPDATED', origin: 'optimisticResolve' }, threadId },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return next;
  }

  function failOptimisticMessage(threadId, clientId, errorCode = 'UNKNOWN') {
    const changes = [];
    const next = updateThread(
      threadId,
      (state) => failOptimisticMessageReducer(state, clientId, errorCode),
      { action: 'optimisticFail', clientId, errorCode },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return next;
  }

  function applyThreadEvent(threadId, event) {
    return applyThreadEventInternal(threadId, event ?? {});
  }

  function applyActionCardIntent(threadId, actionId, intent, optionsAction = {}) {
    const current = threadStates.get(threadId);
    if (!current) {
      throw new Error(`Unknown thread: ${threadId}`);
    }
    const { state: next, auditEvent } = applyActionCardIntentReducer(current, actionId, intent, optionsAction);
    if (next === current) {
      return { state: next, auditEvent };
    }
    threadStates.set(threadId, next);
    const changes = [
      { scope: 'thread', threadId, action: 'actionCard', actionId, intent }
    ];
    updateInbox(
      (stateInbox) =>
        applyInboxEventReducer(stateInbox, {
          type: 'THREAD_UPDATED',
          payload: {
            threadId,
            lastMessageAt: next.thread.lastMessageAt
          }
        }),
      { action: 'sync', event: { type: 'THREAD_UPDATED', origin: 'actionCard' }, threadId },
      changes
    );
    emit(changes);
    if (analytics) {
      analytics({
        type: 'messaging.action_card.intent',
        payload: {
          threadId,
          actionId,
          intent,
          auditEvent
        }
      });
    }
    return { state: next, auditEvent };
  }

  function enqueueNotification(notification, optionsNotification = {}) {
    const changes = [];
    updateNotifications(
      (state) =>
        enqueueNotificationReducer(state, notification, {
          now: optionsNotification.now ?? nowFn()
        }),
      { action: 'enqueue', notification },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return notificationState;
  }

  function flushNotifications(optionsFlush = {}) {
    const changes = [];
    let flushed = [];
    updateNotifications(
      (state) => {
        const result = flushNotificationQueue(state, { now: optionsFlush.now ?? nowFn() });
        flushed = result.notifications;
        return result.state;
      },
      { action: 'flush', count: flushed.length },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return flushed;
  }

  function collectNotificationDigest(optionsDigest = {}) {
    const nextState = cloneNotificationState(notificationState);
    const digest = collectNotificationDigestReducer(nextState, { now: optionsDigest.now ?? nowFn() });
    const changes = [];
    updateNotifications(() => nextState, { action: 'digest', count: digest.length }, changes);
    if (changes.length) {
      emit(changes);
    }
    return digest;
  }

  function pruneExpiredRequests(now = nowFn()) {
    const changes = [];
    updateInbox(
      (state) => pruneExpiredRequestsReducer(state, now),
      { action: 'pruneRequests' },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return inboxState;
  }

  function recordConversationStart(ctx = {}) {
    const changes = [];
    updateInbox(
      (state) =>
        recordConversationStartReducer(state, {
          ...ctx,
          now: ctx.now ?? nowFn()
        }),
      { action: 'conversationStart' },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return inboxState;
  }

  function acceptMessageRequest(requestId, ctx = {}) {
    const changes = [];
    updateInbox(
      (state) =>
        acceptMessageRequestReducer(state, requestId, {
          ...ctx,
          now: ctx.now ?? nowFn()
        }),
      { action: 'requestAccept', requestId },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return inboxState;
  }

  function declineMessageRequest(requestId, optionsDecline = {}) {
    const changes = [];
    updateInbox(
      (state) => declineMessageRequestReducer(state, requestId, optionsDecline),
      { action: optionsDecline.block ? 'requestBlock' : 'requestDecline', requestId },
      changes
    );
    if (changes.length) {
      emit(changes);
    }
    return inboxState;
  }

  function mutateInboxThread(threadId, eventType, changeMeta, analyticsEvent, additionalPayload = {}) {
    if (!threadId) {
      throw new Error(`${changeMeta} requires threadId`);
    }
    const payload = { threadId, ...additionalPayload };
    const event = { type: eventType, payload };
    const changes = [];
    updateInbox((state) => applyInboxEventReducer(state, event), { action: changeMeta, threadId }, changes);
    if (changes.length) {
      emit(changes);
      if (analytics) {
        try {
          analytics({
            type: analyticsEvent,
            payload
          });
        } catch (error) {
          logger?.warn?.('messaging-controller: analytics handler failed', { error, analyticsEvent, payload });
        }
      }
    }
    return inboxState;
  }

  function pinThread(threadId) {
    return mutateInboxThread(threadId, 'THREAD_PINNED', 'threadPinned', 'messaging.thread.pin');
  }

  function unpinThread(threadId) {
    return mutateInboxThread(threadId, 'THREAD_UNPINNED', 'threadUnpinned', 'messaging.thread.unpin');
  }

  function archiveThread(threadId) {
    return mutateInboxThread(threadId, 'THREAD_ARCHIVED', 'threadArchived', 'messaging.thread.archive');
  }

  function unarchiveThread(threadId) {
    return mutateInboxThread(threadId, 'THREAD_UNARCHIVED', 'threadUnarchived', 'messaging.thread.unarchive');
  }

  function muteThread(threadId, optionsMute = {}) {
    const muted = optionsMute.muted ?? true;
    return mutateInboxThread(
      threadId,
      'THREAD_MUTED',
      muted ? 'threadMuted' : 'threadUnmuted',
      muted ? 'messaging.thread.mute' : 'messaging.thread.unmute',
      { muted }
    );
  }

  function unmuteThread(threadId) {
    return muteThread(threadId, { muted: false });
  }

      function hydrateModerationQueue(queueInput = {}) {
        const normalized = Array.isArray(queueInput) ? { cases: queueInput } : queueInput ?? {};
        const changes = [];
        updateModerationQueue(() => createModerationQueue(normalized), { action: 'hydrate' }, changes);
        if (changes.length) {
          emit(changes);
        }
        return moderationQueueState;
      }

      function findModerationCase(caseId) {
        return caseId ? getModerationCaseFromState(moderationQueueState, caseId) : null;
      }

    function enqueueModerationCaseInternal(caseInput, changeMeta, changes) {
      return updateModerationQueue(
        (state) => enqueueModerationCase(state, caseInput),
        changeMeta,
        changes
      );
    }

    function reportMessage(threadId, messageId, optionsReport = {}) {
      if (!threadId) {
        throw new Error('reportMessage requires threadId');
      }
      if (!messageId) {
        throw new Error('reportMessage requires messageId');
      }
      const reportedAt = toIsoInput(optionsReport.reportedAt);
      const reporter = optionsReport.reportedBy ?? viewerUserId ?? null;
      applyThreadEventInternal(threadId, {
        type: 'MESSAGE_MODERATION_UPDATED',
        payload: {
          messageId,
          moderation: {
            state:
              typeof optionsReport.state === 'string'
                ? optionsReport.state.trim().toUpperCase()
                : 'REPORTED',
            reason: optionsReport.reason ?? null,
            reportedBy: reporter,
            reportedAt,
            severity: optionsReport.severity ?? null,
            auditTrailId: optionsReport.auditTrailId ?? null,
            notes: optionsReport.notes ?? null
          }
        }
      });
      if (optionsReport.enqueue === false) {
        const threadState = threadStates.get(threadId);
        return threadState?.messagesById[messageId]?.moderation ?? null;
      }
      const caseId = optionsReport.caseId ?? randomId(`message-${messageId}`);
      const changes = [];
      enqueueModerationCaseInternal(
        {
          caseId,
          type: 'MESSAGE',
          threadId,
          messageId,
          reason: optionsReport.reason ?? 'REPORT',
          severity: optionsReport.severity ?? 'MEDIUM',
          reportedBy: reporter,
          reportedAt,
          metadata: optionsReport.metadata ?? {}
        },
        { action: 'reportMessage', threadId, messageId, caseId },
        changes
      );
      if (changes.length) {
        emit(changes);
      }
      return findModerationCase(caseId);
    }

    function applyThreadModeration(threadId, moderationPatch = {}, optionsModeration = {}) {
      return applyThreadEventInternal(
        threadId,
        {
          type: 'THREAD_MODERATION_UPDATED',
          payload: {
            ...moderationPatch,
            updatedAt: moderationPatch.updatedAt ?? isoNow()
          }
        },
        optionsModeration
      );
    }

    function reportThread(threadId, optionsReport = {}) {
      if (!threadId) {
        throw new Error('reportThread requires threadId');
      }
      if (optionsReport.block === true) {
        return blockThread(threadId, optionsReport);
      }
      if (optionsReport.lock === true) {
        lockThread(threadId, optionsReport);
      } else {
        applyThreadModeration(threadId, {
          reason: optionsReport.reason ?? null,
          auditTrailId: optionsReport.auditTrailId ?? null,
          severity: optionsReport.severity ?? null,
          updatedAt: optionsReport.updatedAt ?? isoNow()
        });
      }
      if (optionsReport.enqueue === false) {
        const threadState = threadStates.get(threadId);
        return threadState ? getThreadModeration(threadState) : null;
      }
      const caseId = optionsReport.caseId ?? randomId(`thread-${threadId}`);
      const reportedAt = toIsoInput(optionsReport.reportedAt);
      const changes = [];
      enqueueModerationCaseInternal(
        {
          caseId,
          type: 'THREAD',
          threadId,
          reason: optionsReport.reason ?? 'REPORT',
          severity: optionsReport.severity ?? 'HIGH',
          reportedBy: optionsReport.reportedBy ?? viewerUserId ?? null,
          reportedAt,
          metadata: optionsReport.metadata ?? {}
        },
        { action: 'reportThread', threadId, caseId },
        changes
      );
      if (changes.length) {
        emit(changes);
      }
      return findModerationCase(caseId);
    }

    function lockThread(threadId, optionsLock = {}) {
      if (!threadId) {
        throw new Error('lockThread requires threadId');
      }
      const updatedAt = toIsoInput(optionsLock.updatedAt);
      applyThreadModeration(threadId, {
        locked: true,
        status: optionsLock.status ?? 'LOCKED',
        reason: optionsLock.reason ?? null,
        auditTrailId: optionsLock.auditTrailId ?? null,
        severity: optionsLock.severity ?? null,
        updatedAt
      });
      if (optionsLock.enqueue !== true) {
        const threadState = threadStates.get(threadId);
        return threadState ? getThreadModeration(threadState) : null;
      }
      const caseId = optionsLock.caseId ?? randomId(`lock-${threadId}`);
      const reportedAt = toIsoInput(optionsLock.reportedAt ?? updatedAt);
      const changes = [];
      enqueueModerationCaseInternal(
        {
          caseId,
          type: 'THREAD',
          threadId,
          reason: optionsLock.reason ?? 'LOCK',
          severity: optionsLock.severity ?? 'HIGH',
          reportedBy: optionsLock.reportedBy ?? viewerUserId ?? null,
          reportedAt,
          metadata: optionsLock.metadata ?? {}
        },
        { action: 'lockThread', threadId, caseId },
        changes
      );
      if (changes.length) {
        emit(changes);
      }
      return findModerationCase(caseId);
    }

    function unlockThread(threadId, optionsUnlock = {}) {
      if (!threadId) {
        throw new Error('unlockThread requires threadId');
      }
      const updatedAt = toIsoInput(optionsUnlock.updatedAt);
      applyThreadModeration(threadId, {
        locked: false,
        status: optionsUnlock.status ?? 'OPEN',
        reason: optionsUnlock.reason ?? null,
        auditTrailId: optionsUnlock.auditTrailId ?? null,
        updatedAt
      });
      if (optionsUnlock.enqueue !== true) {
        const threadState = threadStates.get(threadId);
        return threadState ? getThreadModeration(threadState) : null;
      }
      const caseId = optionsUnlock.caseId ?? randomId(`unlock-${threadId}`);
      const reportedAt = toIsoInput(optionsUnlock.reportedAt ?? updatedAt);
      const changes = [];
      enqueueModerationCaseInternal(
        {
          caseId,
          type: 'THREAD',
          threadId,
          reason: optionsUnlock.reason ?? 'UNLOCK',
          severity: optionsUnlock.severity ?? 'LOW',
          reportedBy: optionsUnlock.reportedBy ?? viewerUserId ?? null,
          reportedAt,
          metadata: optionsUnlock.metadata ?? {}
        },
        { action: 'unlockThread', threadId, caseId },
        changes
      );
      if (changes.length) {
        emit(changes);
      }
      return findModerationCase(caseId);
    }

    function blockThread(threadId, optionsBlock = {}) {
      if (!threadId) {
        throw new Error('blockThread requires threadId');
      }
      const updatedAt = optionsBlock.updatedAt ?? isoNow();
      applyThreadModeration(threadId, {
        blocked: true,
        locked: optionsBlock.locked ?? true,
        status: optionsBlock.status ?? 'LOCKED',
        reason: optionsBlock.reason ?? null,
        auditTrailId: optionsBlock.auditTrailId ?? null,
        severity: optionsBlock.severity ?? null,
        updatedAt
      });
      if (optionsBlock.enqueue === false) {
        return moderationQueueState;
      }
      const changes = [];
      enqueueModerationCaseInternal(
        {
          caseId: optionsBlock.caseId ?? randomId(`block-${threadId}`),
          type: 'THREAD',
          threadId,
          reason: optionsBlock.reason ?? 'BLOCK',
          severity: optionsBlock.severity ?? 'HIGH',
          reportedBy: optionsBlock.reportedBy ?? viewerUserId ?? null,
          reportedAt: optionsBlock.reportedAt ?? updatedAt,
          metadata: optionsBlock.metadata ?? {}
        },
        { action: 'blockThread', threadId },
        changes
      );
      if (changes.length) {
        emit(changes);
      }
      return moderationQueueState;
    }

    function unblockThread(threadId, optionsUnblock = {}) {
      if (!threadId) {
        throw new Error('unblockThread requires threadId');
      }
      const updatedAt = optionsUnblock.updatedAt ?? isoNow();
      applyThreadModeration(threadId, {
        blocked: false,
        status: optionsUnblock.status ?? 'OPEN',
        reason: optionsUnblock.reason ?? null,
        auditTrailId: optionsUnblock.auditTrailId ?? null,
        updatedAt
      });
      if (optionsUnblock.enqueue !== true) {
        return moderationQueueState;
      }
      const changes = [];
      enqueueModerationCaseInternal(
        {
          caseId: optionsUnblock.caseId ?? randomId(`unblock-${threadId}`),
          type: 'THREAD',
          threadId,
          reason: optionsUnblock.reason ?? 'UNBLOCK',
          severity: optionsUnblock.severity ?? 'LOW',
          reportedBy: optionsUnblock.reportedBy ?? viewerUserId ?? null,
          reportedAt: optionsUnblock.reportedAt ?? updatedAt,
          metadata: optionsUnblock.metadata ?? {}
        },
        { action: 'unblockThread', threadId },
        changes
      );
      if (changes.length) {
        emit(changes);
      }
      return moderationQueueState;
    }

    function updateModerationQueueCase(caseId, patch = {}) {
      if (!caseId) {
        throw new Error('updateModerationQueueCase requires caseId');
      }
      const changes = [];
      updateModerationQueue(
        (state) => updateModerationCase(state, caseId, patch),
        { action: 'updateCase', caseId },
        changes
      );
      if (changes.length) {
        emit(changes);
      }
      return moderationQueueState;
    }

    function submitModerationQueueDecision(caseId, decision = {}, optionsDecision = {}) {
      if (!caseId) {
        throw new Error('submitModerationQueueDecision requires caseId');
      }
      const changes = [];
      updateModerationQueue(
        (state) => submitModerationDecisionState(state, caseId, decision, optionsDecision),
        { action: 'decision', caseId, decision },
        changes
      );
      if (changes.length) {
        emit(changes);
      }
      return moderationQueueState;
    }

    function resolveModerationQueueCase(caseId, resolution = {}) {
      if (!caseId) {
        throw new Error('resolveModerationQueueCase requires caseId');
      }
      const changes = [];
      updateModerationQueue(
        (state) => resolveModerationCase(state, caseId, resolution),
        { action: 'resolveCase', caseId },
        changes
      );
      if (changes.length) {
        emit(changes);
      }
      return moderationQueueState;
    }

    function removeModerationQueueCase(caseId) {
      if (!caseId) {
        throw new Error('removeModerationQueueCase requires caseId');
      }
      const changes = [];
      updateModerationQueue(
        (state) => removeModerationCase(state, caseId),
        { action: 'removeCase', caseId },
        changes
      );
      if (changes.length) {
        emit(changes);
      }
      return moderationQueueState;
    }

      function listModerationCases(filters = {}) {
        return selectModerationCases(moderationQueueState, filters);
      }

      function listPendingModerationCases() {
        return getPendingModerationCases(moderationQueueState);
      }

      function getModerationQueueState() {
        return moderationQueueState;
      }

      function getModerationStats() {
        return getModerationQueueStats(moderationQueueState);
      }

      function getModerationCase(caseId) {
        return getModerationCaseFromState(moderationQueueState, caseId);
      }

    function getUploadState() {
        return uploadState;
      }

    function listUploads(filter = {}) {
      const items = Object.values(uploadState.itemsByClientId ?? {}).map((item) => ({ ...item }));
      if (!filter?.threadId) {
        return items;
      }
      return items.filter((item) => item.metadata?.threadId === filter.threadId);
    }

    function registerUpload(descriptor, optionsUpload = {}) {
      const changes = [];
      let registered = null;
      const changed = updateUploads((state) => {
        const next = registerClientUpload(state, descriptor, optionsUpload);
        registered = getUpload(next, descriptor.clientId);
        return {
          state: next,
          change: registered
            ? {
                action: 'uploadRegistered',
                clientId: registered.clientId,
                attachmentId: registered.attachmentId ?? null,
                status: registered.status,
                threadId: registered.metadata?.threadId ?? null
              }
            : null
        };
      }, changes);
      if (changed && changes.length) {
        emit(changes);
      }
      return registered;
    }

    function markUploadSigned(clientId, details = {}, optionsUpload = {}) {
      const changes = [];
      let item = null;
      const changed = updateUploads((state) => {
        const next = markUploadSignedState(state, clientId, details, optionsUpload);
        if (next === state) {
          return { state: next, change: null };
        }
        item = getUpload(next, clientId);
        return {
          state: next,
          change: item
            ? {
                action: 'uploadSigned',
                clientId,
                attachmentId: item.attachmentId ?? details.attachmentId ?? null,
                status: item.status,
                threadId: item.metadata?.threadId ?? null
              }
            : null
        };
      }, changes);
      if (changed && changes.length) {
        emit(changes);
      }
      return item;
    }

    function markUploadProgress(clientId, progress, optionsUpload = {}) {
      const changes = [];
      let item = null;
      const changed = updateUploads((state) => {
        const next = markUploadProgressState(state, clientId, progress, optionsUpload);
        if (next === state) {
          return { state: next, change: null };
        }
        item = getUpload(next, clientId);
        return {
          state: next,
          change: item
            ? {
                action: 'uploadProgress',
                clientId,
                attachmentId: item.attachmentId ?? null,
                status: item.status,
                uploadedBytes: item.progress?.uploadedBytes ?? null,
                totalBytes: item.progress?.totalBytes ?? null,
                threadId: item.metadata?.threadId ?? null
              }
            : null
        };
      }, changes);
      if (changed && changes.length) {
        emit(changes);
      }
      return item;
    }

    function markUploadComplete(clientId, details = {}, optionsUpload = {}) {
      const changes = [];
      let item = null;
      const changed = updateUploads((state) => {
        const next = markUploadCompleteState(state, clientId, details, optionsUpload);
        if (next === state) {
          return { state: next, change: null };
        }
        item = getUpload(next, clientId);
        return {
          state: next,
          change: item
            ? {
                action: 'uploadComplete',
                clientId,
                attachmentId: item.attachmentId ?? details.attachmentId ?? null,
                status: item.status,
                threadId: item.metadata?.threadId ?? null
              }
            : null
        };
      }, changes);
      if (changed && changes.length) {
        emit(changes);
      }
      return item;
    }

    function applyAttachmentStatus(update, optionsUpload = {}) {
      const changes = [];
      let item = null;
      const changed = updateUploads((state) => {
        const next = applyServerAttachmentStatus(state, update, optionsUpload);
        if (next === state) {
          return { state: next, change: null };
        }
        item = update?.attachmentId ? getUploadByAttachmentId(next, update.attachmentId) : null;
        return {
          state: next,
          change: item
            ? {
                action: 'uploadStatus',
                clientId: item.clientId,
                attachmentId: item.attachmentId ?? update?.attachmentId ?? null,
                status: item.status,
                nsfwBand: item.nsfwBand ?? null,
                threadId: item.metadata?.threadId ?? null
              }
            : null
        };
      }, changes);
      if (changed && changes.length) {
        emit(changes);
      }
      return item;
    }

    function markUploadFailed(clientId, details = {}, optionsUpload = {}) {
      const changes = [];
      let item = null;
      const changed = updateUploads((state) => {
        const next = markUploadFailedState(state, clientId, details, optionsUpload);
        if (next === state) {
          return { state: next, change: null };
        }
        item = getUpload(next, clientId);
        return {
          state: next,
          change: item
            ? {
                action: 'uploadFailed',
                clientId,
                attachmentId: item.attachmentId ?? null,
                status: item.status,
                errorCode: item.errorCode ?? details.errorCode ?? null,
                threadId: item.metadata?.threadId ?? null
              }
            : null
        };
      }, changes);
      if (changed && changes.length) {
        emit(changes);
      }
      return item;
    }

    function cancelUpload(clientId, optionsUpload = {}) {
      const changes = [];
      let item = null;
      const changed = updateUploads((state) => {
        const next = cancelUploadState(state, clientId, optionsUpload);
        if (next === state) {
          return { state: next, change: null };
        }
        item = getUpload(next, clientId);
        return {
          state: next,
          change: item
            ? {
                action: 'uploadCancelled',
                clientId,
                attachmentId: item.attachmentId ?? null,
                status: item.status,
                threadId: item.metadata?.threadId ?? null
              }
            : null
        };
      }, changes);
      if (changed && changes.length) {
        emit(changes);
      }
      return item;
    }

    function pruneUploads(optionsPrune = {}) {
      let removedCount = 0;
      const changes = [];
      const changed = updateUploads((state) => {
        const before = new Set(state.order);
        const next = pruneUploadsState(state, optionsPrune);
        if (next === state) {
          return { state, change: null };
        }
        const after = new Set(next.order);
        for (const clientId of before) {
          if (!after.has(clientId)) {
            removedCount += 1;
          }
        }
        return {
          state: next,
          change: {
            action: 'uploadPruned',
            removed: removedCount,
            remaining: next.order.length
          }
        };
      }, changes);
      if (changed && changes.length) {
        emit(changes);
      }
      return uploadState;
    }

  return {
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('listener must be a function');
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot,
    getViewerUserId: () => viewerUserId,
    setViewerUserId(id) {
      viewerUserId = id ?? null;
    },
    getInboxState: () => inboxState,
    getThreadState: (threadId) => threadStates.get(threadId) ?? null,
    listThreadIds: () => Array.from(threadStates.keys()),
    getNotificationState: () => notificationState,
    hydrateInbox,
    applyInboxEvent,
    hydrateThread,
    applyThreadEvent,
    removeThread,
    markThreadRead,
    enqueueOptimisticMessage,
    resolveOptimisticMessage,
    failOptimisticMessage,
    applyActionCardIntent,
    enqueueNotification,
    flushNotifications,
    collectNotificationDigest,
    listPendingNotifications: () => listPendingNotifications(notificationState),
    pruneExpiredRequests,
    getTotalUnread: () => getTotalUnread(inboxState),
    selectInboxThreads: (optionsSelect = {}) => selectThreads(inboxState, optionsSelect),
    canStartConversation: (ctx = {}) =>
      canStartConversation(inboxState, {
        ...ctx,
        now: ctx.now ?? nowFn()
      }),
    recordConversationStart,
    acceptMessageRequest,
    declineMessageRequest,
    pinThread,
    unpinThread,
      archiveThread,
      unarchiveThread,
      muteThread,
      unmuteThread,
      hydrateModerationQueue,
      getModerationQueueState,
      getModerationStats,
      listModerationCases,
      listPendingModerationCases,
      getModerationCase,
      reportMessage,
      reportThread,
      lockThread,
      unlockThread,
      blockThread,
      unblockThread,
      updateModerationQueueCase,
      submitModerationQueueDecision,
      resolveModerationQueueCase,
      removeModerationQueueCase,
    getUploadState,
    listUploads,
    getUpload: (clientId) => getUpload(uploadState, clientId),
    getUploadByAttachmentId: (attachmentId) => getUploadByAttachmentId(uploadState, attachmentId),
    registerUpload,
    markUploadSigned,
    markUploadProgress,
    markUploadComplete,
    applyAttachmentStatus,
    markUploadFailed,
    cancelUpload,
    pruneUploads,
    getUnreadMessageIds: (threadId, userId) => {
      const thread = threadStates.get(threadId);
      if (!thread) {
        return [];
      }
      return getUnreadMessageIds(thread, userId);
    },
    getActionCards: (threadId) => {
      const thread = threadStates.get(threadId);
      if (!thread) {
        return [];
      }
      return getActionCards(thread);
    },
    getActionCardTransitions: (threadId, actionId, optionsTransitions = {}) => {
      const thread = threadStates.get(threadId);
      if (!thread) {
        return [];
      }
      return getActionCardTransitions(thread, actionId, optionsTransitions);
    }
  };
}
