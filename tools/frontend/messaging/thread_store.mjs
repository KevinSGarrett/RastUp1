import { transitionActionCard, getAllowedTransitions } from './action_cards.mjs';
const DEFAULT_PRESENCE_TTL_MS = 60 * 1000; // 60s

function normalizeTimestamp(value) {
  const ts = Date.parse(value);
  if (Number.isFinite(ts)) {
    return new Date(ts).toISOString();
  }
  return new Date(0).toISOString();
}

/**
 * Creates a normalized thread state.
 * @param {{
 *   thread: {
 *     threadId: string;
 *     kind: 'INQUIRY'|'PROJECT';
 *     status?: string;
 *     safeModeRequired?: boolean;
 *     lastMessageAt?: string;
 *   };
 *   messages?: Array<{
 *     messageId: string;
 *     createdAt: string;
 *     authorUserId: string;
 *     type: 'TEXT'|'ASSET'|'SYSTEM'|'ACTION';
 *     body?: string;
 *     attachments?: any[];
 *     action?: any;
 *     nsfwBand?: number;
 *   }>;
 *   actionCards?: Array<{
 *     actionId: string;
 *     type: string;
 *     state: string;
 *     version: number;
 *     createdAt: string;
 *     updatedAt: string;
 *     payload?: any;
 *   }>;
 *   participants?: Array<{
 *     userId: string;
 *     role: string;
 *     lastReadMsgId?: string|null;
 *     lastReadAt?: string|null;
 *   }>;
 *   projectPanel?: { version: number; tabs: Record<string, any> };
 *   safeMode?: { bandMax?: number; override?: boolean };
 *   presenceTtlMs?: number;
 * }} input
 */
export function createThreadState(input) {
  if (!input?.thread?.threadId) {
    throw new Error('createThreadState requires threadId');
  }
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const actionCards = Array.isArray(input.actionCards) ? input.actionCards : [];
  const participants = Array.isArray(input.participants) ? input.participants : [];
  const presenceTtlMs = input.presenceTtlMs ?? DEFAULT_PRESENCE_TTL_MS;

  const normalizedMessages = {};
  const messageOrder = [...messages]
    .sort((a, b) => {
      const aTs = Date.parse(a.createdAt ?? 0) || 0;
      const bTs = Date.parse(b.createdAt ?? 0) || 0;
      if (aTs === bTs) {
        return (a.messageId ?? '').localeCompare(b.messageId ?? '');
      }
      return aTs - bTs;
    })
    .map((message) => {
      normalizedMessages[message.messageId] = {
        messageId: message.messageId,
        createdAt: normalizeTimestamp(message.createdAt),
        authorUserId: message.authorUserId,
        type: message.type,
        body: message.body ?? '',
        attachments: Array.isArray(message.attachments) ? message.attachments.map((att) => ({ ...att })) : [],
        action: message.action ? { ...message.action } : null,
        nsfwBand: Number.isInteger(message.nsfwBand) ? message.nsfwBand : 0,
        deliveryState: 'SENT'
      };
      return message.messageId;
    });

  const actionCardsById = {};
  const actionCardOrder = [...actionCards]
    .sort((a, b) => {
      const aTs = Date.parse(a.createdAt ?? 0) || 0;
      const bTs = Date.parse(b.createdAt ?? 0) || 0;
      if (aTs === bTs) {
        return (a.actionId ?? '').localeCompare(b.actionId ?? '');
      }
      return aTs - bTs;
    })
    .map((card) => {
      actionCardsById[card.actionId] = {
        actionId: card.actionId,
        type: card.type,
        state: card.state,
        version: card.version ?? 0,
        createdAt: normalizeTimestamp(card.createdAt),
        updatedAt: normalizeTimestamp(card.updatedAt ?? card.createdAt),
        payload: card.payload ? { ...card.payload } : {}
      };
      return card.actionId;
    });

  const participantsById = {};
  for (const participant of participants) {
    participantsById[participant.userId] = {
      userId: participant.userId,
      role: participant.role,
      lastReadMsgId: participant.lastReadMsgId ?? null,
      lastReadAt: participant.lastReadAt ? normalizeTimestamp(participant.lastReadAt) : null
    };
  }

  const lastMessageFromTimeline =
    messageOrder.length > 0 ? normalizedMessages[messageOrder[messageOrder.length - 1]].createdAt : null;
  const providedLastMessage = input.thread.lastMessageAt ? normalizeTimestamp(input.thread.lastMessageAt) : null;
  let resolvedLastMessageAt = providedLastMessage ?? lastMessageFromTimeline;
  if (providedLastMessage && lastMessageFromTimeline) {
    const providedTs = Date.parse(providedLastMessage) || 0;
    const timelineTs = Date.parse(lastMessageFromTimeline) || 0;
    resolvedLastMessageAt = providedTs > timelineTs ? providedLastMessage : lastMessageFromTimeline;
  }

  return {
    thread: {
      threadId: input.thread.threadId,
      kind: input.thread.kind,
      status: input.thread.status ?? 'OPEN',
      safeModeRequired: Boolean(input.thread.safeModeRequired),
      lastMessageAt: resolvedLastMessageAt
    },
    messagesById: normalizedMessages,
    messageOrder,
    optimisticByClientId: {},
    actionCardsById,
    actionCardOrder,
    participantsById,
    presenceByUserId: {},
    projectPanel: input.projectPanel
      ? { version: input.projectPanel.version ?? 0, tabs: { ...input.projectPanel.tabs } }
      : { version: 0, tabs: {} },
    safeMode: {
      bandMax: input.safeMode?.bandMax ?? 1,
      override: Boolean(input.safeMode?.override)
    },
    presenceTtlMs,
    lastEventAt: Date.now()
  };
}

function cloneState(state) {
  return {
    thread: { ...state.thread },
    messagesById: { ...state.messagesById },
    messageOrder: [...state.messageOrder],
    optimisticByClientId: { ...state.optimisticByClientId },
    actionCardsById: { ...state.actionCardsById },
    actionCardOrder: [...state.actionCardOrder],
    participantsById: Object.fromEntries(
      Object.entries(state.participantsById).map(([userId, participant]) => [userId, { ...participant }])
    ),
    presenceByUserId: Object.fromEntries(
      Object.entries(state.presenceByUserId).map(([userId, presence]) => [userId, { ...presence }])
    ),
    projectPanel: { version: state.projectPanel.version, tabs: { ...state.projectPanel.tabs } },
    safeMode: { ...state.safeMode },
    presenceTtlMs: state.presenceTtlMs,
    lastEventAt: state.lastEventAt
  };
}

function insertMessageOrdered(next, message) {
  const messageId = message.messageId;
  next.messagesById[messageId] = message;
  next.messageOrder = next.messageOrder.filter((id) => id !== messageId);
  const createdAt = Date.parse(message.createdAt ?? 0) || 0;
  let inserted = false;
  for (let i = 0; i < next.messageOrder.length; i += 1) {
    const other = next.messagesById[next.messageOrder[i]];
    const otherTs = Date.parse(other?.createdAt ?? 0) || 0;
    if (createdAt < otherTs) {
      next.messageOrder.splice(i, 0, messageId);
      inserted = true;
      break;
    }
    if (createdAt === otherTs && messageId.localeCompare(next.messageOrder[i]) < 0) {
      next.messageOrder.splice(i, 0, messageId);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    next.messageOrder.push(messageId);
  }
  const lastMessage = next.messagesById[next.messageOrder[next.messageOrder.length - 1]];
  next.thread.lastMessageAt = lastMessage?.createdAt ?? next.thread.lastMessageAt;
}

function upsertActionCard(next, incoming) {
  const existing = next.actionCardsById[incoming.actionId];
  if (existing && existing.version > incoming.version) {
    return;
  }
  next.actionCardsById[incoming.actionId] = {
    actionId: incoming.actionId,
    type: incoming.type,
    state: incoming.state,
    version: incoming.version ?? 0,
    createdAt: normalizeTimestamp(incoming.createdAt ?? incoming.updatedAt ?? new Date().toISOString()),
    updatedAt: normalizeTimestamp(incoming.updatedAt ?? incoming.createdAt ?? new Date().toISOString()),
    payload: incoming.payload ? { ...incoming.payload } : {}
  };
  next.actionCardOrder = next.actionCardOrder.filter((id) => id !== incoming.actionId);
  const createdTs = Date.parse(next.actionCardsById[incoming.actionId].createdAt) || 0;
  let inserted = false;
  for (let i = 0; i < next.actionCardOrder.length; i += 1) {
    const target = next.actionCardsById[next.actionCardOrder[i]];
    const targetTs = Date.parse(target.createdAt ?? 0) || 0;
    if (createdTs < targetTs) {
      next.actionCardOrder.splice(i, 0, incoming.actionId);
      inserted = true;
      break;
    }
    if (createdTs === targetTs && incoming.actionId.localeCompare(next.actionCardOrder[i]) < 0) {
      next.actionCardOrder.splice(i, 0, incoming.actionId);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    next.actionCardOrder.push(incoming.actionId);
  }
}

/**
 * Applies a thread-level event.
 * @param {ReturnType<typeof createThreadState>} state
 * @param {{ type: string; payload?: any }} event
 */
export function applyThreadEvent(state, event) {
  const next = cloneState(state);
  const payload = event?.payload ?? {};
  switch (event?.type) {
    case 'MESSAGE_CREATED': {
      const message = {
        messageId: payload.messageId,
        createdAt: normalizeTimestamp(payload.createdAt),
        authorUserId: payload.authorUserId,
        type: payload.type,
        body: payload.body ?? '',
        attachments: Array.isArray(payload.attachments) ? payload.attachments.map((att) => ({ ...att })) : [],
        action: payload.action ? { ...payload.action } : null,
        nsfwBand: Number.isInteger(payload.nsfwBand) ? payload.nsfwBand : 0,
        deliveryState: 'SENT'
      };
      insertMessageOrdered(next, message);
      if (payload.clientId && next.optimisticByClientId[payload.clientId]) {
        const tempId = next.optimisticByClientId[payload.clientId];
        delete next.messagesById[tempId];
        next.messageOrder = next.messageOrder.filter((id) => id !== tempId);
        delete next.optimisticByClientId[payload.clientId];
      }
      break;
    }
    case 'MESSAGE_UPDATED': {
      const existing = next.messagesById[payload.messageId];
      if (!existing) {
        break;
      }
      next.messagesById[payload.messageId] = {
        ...existing,
        ...payload,
        createdAt: normalizeTimestamp(payload.createdAt ?? existing.createdAt),
        deliveryState: existing.deliveryState
      };
      insertMessageOrdered(next, next.messagesById[payload.messageId]);
      break;
    }
    case 'MESSAGE_FAILED': {
      if (!payload.clientId) {
        break;
      }
      const tempId = next.optimisticByClientId[payload.clientId];
      if (!tempId) {
        break;
      }
      next.messagesById[tempId] = {
        ...next.messagesById[tempId],
        deliveryState: 'FAILED',
        errorCode: payload.errorCode ?? 'UNKNOWN'
      };
      break;
    }
    case 'ACTION_CARD_UPSERT':
      upsertActionCard(next, payload);
      break;
    case 'READ_RECEIPT_UPDATED': {
      const participant = next.participantsById[payload.userId] ?? {
        userId: payload.userId,
        role: payload.role ?? 'guest',
        lastReadMsgId: null,
        lastReadAt: null
      };
      participant.lastReadMsgId = payload.lastReadMsgId ?? participant.lastReadMsgId;
      participant.lastReadAt = payload.lastReadAt ? normalizeTimestamp(payload.lastReadAt) : participant.lastReadAt;
      next.participantsById[payload.userId] = participant;
      break;
    }
    case 'PRESENCE_EVENT': {
      const now = Date.now();
      const existing = next.presenceByUserId[payload.userId] ?? {};
      next.presenceByUserId[payload.userId] = {
        lastSeen: payload.lastSeen ? normalizeTimestamp(payload.lastSeen) : existing.lastSeen ?? new Date(now).toISOString(),
        typing: Boolean(payload.typing)
      };
      prunePresence(next, now);
      break;
    }
    case 'THREAD_STATUS_CHANGED':
      next.thread.status = payload.status ?? next.thread.status;
      break;
    case 'SAFE_MODE_OVERRIDE':
      next.safeMode.override = Boolean(payload.override);
      if (typeof payload.bandMax === 'number') {
        next.safeMode.bandMax = payload.bandMax;
      }
      break;
    case 'PROJECT_PANEL_UPDATED':
      if ((payload.version ?? 0) >= next.projectPanel.version) {
        next.projectPanel = {
          version: payload.version ?? next.projectPanel.version,
          tabs: { ...next.projectPanel.tabs, ...(payload.tabs ?? {}) }
        };
      }
      break;
    default:
      return state;
  }
  next.lastEventAt = Date.now();
  return next;
}

function prunePresence(state, now = Date.now()) {
  const cutoff = now - state.presenceTtlMs;
  for (const [userId, presence] of Object.entries(state.presenceByUserId)) {
    const lastSeenTs = Date.parse(presence.lastSeen ?? 0) || 0;
    if (lastSeenTs < cutoff) {
      delete state.presenceByUserId[userId];
    }
  }
}

/**
 * Returns presence snapshot with TTL applied.
 * @param {ReturnType<typeof createThreadState>} state
 * @param {number} now
 */
export function getPresenceSnapshot(state, now = Date.now()) {
  const copy = cloneState(state);
  prunePresence(copy, now);
  return copy.presenceByUserId;
}

/**
 * Enqueues an optimistic message and returns new state.
 * @param {ReturnType<typeof createThreadState>} state
 * @param {{ clientId: string; createdAt: string; authorUserId: string; body?: string; attachments?: any[]; type?: string }} input
 */
export function enqueueOptimisticMessage(state, input) {
  if (!input?.clientId) {
    throw new Error('enqueueOptimisticMessage requires clientId');
  }
  const next = cloneState(state);
  const tempId = `temp:${input.clientId}`;
  next.optimisticByClientId[input.clientId] = tempId;
  const message = {
    messageId: tempId,
    createdAt: normalizeTimestamp(input.createdAt ?? new Date().toISOString()),
    authorUserId: input.authorUserId,
    type: input.type ?? 'TEXT',
    body: input.body ?? '',
    attachments: Array.isArray(input.attachments) ? input.attachments.map((att) => ({ ...att })) : [],
    action: null,
    nsfwBand: 0,
    deliveryState: 'SENDING'
  };
  insertMessageOrdered(next, message);
  next.lastEventAt = Date.now();
  return next;
}

/**
 * Resolves an optimistic message with the official payload.
 * @param {ReturnType<typeof createThreadState>} state
 * @param {string} clientId
 * @param {{ messageId: string; createdAt: string; authorUserId: string; type: string; body?: string; attachments?: any[]; action?: any; nsfwBand?: number }} payload
 */
export function resolveOptimisticMessage(state, clientId, payload) {
  const tempId = state.optimisticByClientId[clientId];
  if (!tempId) {
    return applyThreadEvent(state, { type: 'MESSAGE_CREATED', payload });
  }
  const next = cloneState(state);
  delete next.optimisticByClientId[clientId];
  next.messageOrder = next.messageOrder.filter((id) => id !== tempId);
  delete next.messagesById[tempId];
  insertMessageOrdered(next, {
    messageId: payload.messageId,
    createdAt: normalizeTimestamp(payload.createdAt),
    authorUserId: payload.authorUserId,
    type: payload.type,
    body: payload.body ?? '',
    attachments: Array.isArray(payload.attachments) ? payload.attachments.map((att) => ({ ...att })) : [],
    action: payload.action ? { ...payload.action } : null,
    nsfwBand: Number.isInteger(payload.nsfwBand) ? payload.nsfwBand : 0,
    deliveryState: 'SENT'
  });
  next.lastEventAt = Date.now();
  return next;
}

/**
 * Marks an optimistic message as failed (deliveryState=FAILED).
 * @param {ReturnType<typeof createThreadState>} state
 * @param {string} clientId
 * @param {string} errorCode
 */
export function failOptimisticMessage(state, clientId, errorCode = 'UNKNOWN') {
  const tempId = state.optimisticByClientId[clientId];
  if (!tempId || !state.messagesById[tempId]) {
    return state;
  }
  const next = cloneState(state);
  next.messagesById[tempId] = {
    ...next.messagesById[tempId],
    deliveryState: 'FAILED',
    errorCode
  };
  next.lastEventAt = Date.now();
  return next;
}

/**
 * Returns unread message IDs for a participant.
 * @param {ReturnType<typeof createThreadState>} state
 * @param {string} userId
 */
export function getUnreadMessageIds(state, userId) {
  const participant = state.participantsById[userId];
  if (!participant?.lastReadMsgId) {
    return state.messageOrder;
  }
  const lastIndex = state.messageOrder.indexOf(participant.lastReadMsgId);
  if (lastIndex === -1) {
    return state.messageOrder;
  }
  return state.messageOrder.slice(lastIndex + 1);
}

/**
 * Returns array of action cards sorted by createdAt.
 * @param {ReturnType<typeof createThreadState>} state
 */
export function getActionCards(state) {
  return state.actionCardOrder.map((id) => state.actionCardsById[id]).filter(Boolean);
}

/**
 * Returns the allowed transitions for an action card in the thread.
 * @param {ReturnType<typeof createThreadState>} state
 * @param {string} actionId
 * @param {{ definitions?: Record<string, any> }} [options]
 */
export function getActionCardTransitions(state, actionId, options = {}) {
  const card = state.actionCardsById[actionId];
  if (!card) {
    return [];
  }
  return getAllowedTransitions(card, options);
}

/**
 * Applies a client-side intent to an action card, returning new state and audit metadata.
 * @param {ReturnType<typeof createThreadState>} state
 * @param {string} actionId
 * @param {string} intent
 * @param {{
 *   now?: number;
 *   updatedAt?: string;
 *   version?: number;
 *   versionIncrement?: number;
 *   metadata?: Record<string, any>;
 *   payloadPatch?: Record<string, any>;
 *   mutatePayload?: (payload: Record<string, any>, nextCard: any) => Record<string, any>;
 *   actorUserId?: string|null;
 *   threadId?: string|null;
 *   auditMetadata?: Record<string, any>|null;
 *   emitAudit?: boolean;
 *   definitions?: Record<string, any>;
 * }} [options]
 * @returns {{ state: ReturnType<typeof createThreadState>; auditEvent: any }}
 */
export function applyActionCardIntent(state, actionId, intent, options = {}) {
  const card = state.actionCardsById[actionId];
  if (!card) {
    throw new Error(`Unknown action card: ${actionId}`);
  }
  const { card: nextCard, auditEvent } = transitionActionCard(card, intent, options);
  const next = cloneState(state);
  next.actionCardsById[actionId] = nextCard;
  if (!next.actionCardOrder.includes(actionId)) {
    next.actionCardOrder.push(actionId);
  }
  next.lastEventAt = Date.now();
  return { state: next, auditEvent };
}
