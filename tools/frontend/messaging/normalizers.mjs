const ISO_EPOCH = new Date(0).toISOString();

function toIso(value, fallback = ISO_EPOCH) {
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

function asArray(source) {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if (Array.isArray(source.edges)) {
    return source.edges.map((edge) => (edge && typeof edge === 'object' ? edge.node ?? edge : edge)).filter(Boolean);
  }
  if (Array.isArray(source.items)) {
    return source.items;
  }
  return [];
}

function toStringId(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return false;
}

function toNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeThreadKind(kind) {
  const value = typeof kind === 'string' ? kind.toUpperCase().trim() : '';
  if (value === 'PROJECT') return 'PROJECT';
  return 'INQUIRY';
}

function cloneAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((att) => att && typeof att === 'object')
    .map((att) => ({ ...att }));
}

function extractSafeMode(node) {
  if (!node) {
    return { bandMax: 1, override: false };
  }
  const bandMax =
    typeof node.bandMax === 'number'
      ? node.bandMax
      : typeof node.band === 'number'
        ? node.band
        : typeof node.nsfwBandMax === 'number'
          ? node.nsfwBandMax
          : 1;
  const override = toBoolean(node.override ?? node.hasOverride ?? node.safeModeOverride);
  return { bandMax, override };
}

function pickFirst(...candidates) {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) {
      return candidate;
    }
  }
  return undefined;
}

function normalizeMessageNode(node, { partial = false } = {}) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const messageId =
    toStringId(node.messageId ?? node.id ?? node.messageID ?? node.nodeId) ??
    (partial ? null : toStringId(node.clientId ? `temp:${node.clientId}` : null));
  if (!messageId) {
    return null;
  }
  const result = { messageId };

  const createdAtRaw = pickFirst(node.createdAt, node.timestamp, node.sentAt);
  if (!partial || createdAtRaw !== undefined) {
    result.createdAt = toIso(createdAtRaw);
  }

  const authorUserId = pickFirst(
    node.authorUserId,
    node.author?.userId,
    node.author?.id,
    node.authorId,
    node.senderId
  );
  if (!partial || authorUserId !== undefined) {
    result.authorUserId = authorUserId ?? null;
  }

  const typeRaw = pickFirst(node.type, node.messageType, node.kind);
  if (!partial || typeRaw !== undefined) {
    result.type = typeof typeRaw === 'string' ? typeRaw.toUpperCase() : 'TEXT';
  }

  if (!partial || node.body !== undefined) {
    result.body = node.body ?? '';
  }

  if (!partial || node.attachments !== undefined || node.assets !== undefined) {
    const attachments = pickFirst(node.attachments, node.assets);
    result.attachments = cloneAttachments(attachments);
  }

  if (!partial || node.action !== undefined || node.actionCard !== undefined) {
    const action = pickFirst(node.action, node.actionCard);
    result.action = action ? { ...action } : null;
  }

  const nsfwRaw = pickFirst(node.nsfwBand, node.safeModeBand, node.nsfwLevel);
  if (!partial || nsfwRaw !== undefined) {
    const band = Number.isInteger(nsfwRaw) ? nsfwRaw : 0;
    result.nsfwBand = band;
  }

  const clientId = node.clientId ?? node.localId ?? node.optimisticId;
  if (clientId) {
    result.clientId = clientId;
  }

  if (!partial || node.moderation !== undefined || node.moderationState !== undefined) {
    const moderationValue = pickFirst(node.moderation, node.moderationState, node.moderationMetadata);
    if (moderationValue && typeof moderationValue === 'object') {
      result.moderation = JSON.parse(JSON.stringify(moderationValue));
    } else if (moderationValue !== undefined) {
      result.moderation = moderationValue;
    } else if (!partial) {
      result.moderation = null;
    }
  }

  return result;
}

function normalizeActionCardNode(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const actionId = toStringId(node.actionId ?? node.id);
  if (!actionId) {
    return null;
  }
  const type = pickFirst(node.type, node.actionType, node.kind);
  const state = pickFirst(node.state, node.status);
  const payload = node.payload ?? node.data ?? null;
  return {
    actionId,
    type: typeof type === 'string' ? type.toUpperCase() : 'UNKNOWN',
    state: typeof state === 'string' ? state.toUpperCase() : 'UNKNOWN',
    version: toNumber(node.version ?? node.revision ?? node.actionVersion ?? 0, 0),
    createdAt: toIso(pickFirst(node.createdAt, node.timestamp, node.insertedAt)),
    updatedAt: toIso(
      pickFirst(node.updatedAt, node.modifiedAt, node.lastUpdatedAt, node.timestamp),
      toIso(pickFirst(node.createdAt, node.timestamp, node.insertedAt))
    ),
    payload: payload && typeof payload === 'object' ? { ...payload } : {}
  };
}

function normalizeParticipantNode(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const userId = toStringId(node.userId ?? node.id);
  if (!userId) {
    return null;
  }
  return {
    userId,
    role: (node.role ?? node.participantRole ?? 'GUEST').toUpperCase(),
    lastReadMsgId: node.lastReadMsgId ?? node.lastReadMessageId ?? null,
    lastReadAt: node.lastReadAt ? toIso(node.lastReadAt) : null
  };
}

function normalizeMessageRequestNode(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const requestId = toStringId(node.requestId ?? node.id);
  const threadId = toStringId(node.threadId ?? node.thread?.threadId ?? node.thread?.id);
  if (!requestId || !threadId) {
    return null;
  }
  return {
    requestId,
    threadId,
    creditCost: toNumber(pickFirst(node.creditCost, node.cost, node.creditPrice), 0),
    expiresAt: toIso(pickFirst(node.expiresAt, node.expiration)),
    createdAt: toIso(pickFirst(node.createdAt, node.requestedAt, node.insertedAt))
  };
}

function normalizeRateLimitNode(node) {
  if (!node || typeof node !== 'object') {
    return {
      windowMs: 24 * 60 * 60 * 1000,
      maxConversations: 5,
      initiations: []
    };
  }
  const initiations = Array.isArray(node.initiations)
    ? node.initiations
        .map((ts) => {
          if (typeof ts === 'number' && Number.isFinite(ts)) {
            return ts;
          }
          const parsed = Date.parse(ts);
          return Number.isFinite(parsed) ? parsed : null;
        })
        .filter((ts) => ts !== null)
    : [];
  return {
    windowMs: toNumber(pickFirst(node.windowMs, node.windowMilliseconds, node.windowMsDuration), 24 * 60 * 60 * 1000),
    maxConversations: toNumber(pickFirst(node.maxConversations, node.limit, node.max), 5),
    initiations
  };
}

function normalizeCreditsNode(node) {
  if (!node || typeof node !== 'object') {
    return {
      available: Infinity,
      costPerRequest: 0,
      floor: 0
    };
  }
  return {
    available: toNumber(pickFirst(node.available, node.remaining, node.balance), Infinity),
    costPerRequest: toNumber(pickFirst(node.costPerRequest, node.cost, node.price), 0),
    floor: toNumber(pickFirst(node.floor, node.minimum, node.minBalance), 0)
  };
}

function normalizeThreadHeader(node) {
  if (!node || typeof node !== 'object') {
    throw new Error('normalizeThreadHeader requires a thread object');
  }
  const threadId = toStringId(node.threadId ?? node.id);
  if (!threadId) {
    throw new Error('normalizeThreadHeader requires threadId');
  }
  return {
    threadId,
    kind: normalizeThreadKind(node.kind),
    status: (node.status ?? node.state ?? 'OPEN').toUpperCase(),
    safeModeRequired: toBoolean(pickFirst(node.safeModeRequired, node.requiresSafeMode)),
    lastMessageAt: toIso(pickFirst(node.lastMessageAt, node.lastMessage?.createdAt, node.updatedAt, node.createdAt), null),
    moderation:
      node.moderation && typeof node.moderation === 'object'
        ? JSON.parse(JSON.stringify(node.moderation))
        : node.moderation ?? null
  };
}

function normalizeProjectPanel(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const version = toNumber(pickFirst(node.version, node.revision), 0);
  const tabs = node.tabs && typeof node.tabs === 'object' ? { ...node.tabs } : {};
  return { version, tabs };
}

/**
 * Normalizes data from the inbox GraphQL query into the shape expected by createInboxState.
 * @param {{ threads?: any; edges?: any; items?: any; messageRequests?: any; requests?: any; rateLimit?: any; credits?: any }} payload
 */
export function normalizeInboxPayload(payload = {}) {
  const threadNodes = asArray(payload.threads ?? payload.edges ?? payload.items);
  const threads = threadNodes
    .map((node) => {
      if (node?.node) {
        return node.node;
      }
      return node;
    })
    .map((node) => {
      if (!node || typeof node !== 'object') return null;
      const threadId = toStringId(node.threadId ?? node.id);
      if (!threadId) return null;
      return {
        threadId,
        kind: normalizeThreadKind(node.kind),
        lastMessageAt: toIso(pickFirst(node.lastMessageAt, node.lastMessage?.createdAt, node.updatedAt, node.createdAt)),
        unreadCount: toNumber(pickFirst(node.unreadCount, node.unread), 0),
        pinned: toBoolean(node.pinned ?? node.isPinned),
        archived: toBoolean(node.archived ?? node.isArchived),
        muted: toBoolean(node.muted ?? node.isMuted),
        safeModeRequired: toBoolean(pickFirst(node.safeModeRequired, node.requiresSafeMode))
      };
    })
    .filter(Boolean);

  const requestNodes = asArray(payload.messageRequests ?? payload.requests ?? []);
  const requests = requestNodes
    .map((node) => {
      if (node?.node) {
        return node.node;
      }
      return node;
    })
    .map(normalizeMessageRequestNode)
    .filter(Boolean);

  const rateLimit = normalizeRateLimitNode(payload.rateLimit ?? payload.rateLimitInfo);
  const credits = normalizeCreditsNode(payload.credits ?? payload.creditSummary);

  return {
    threads,
    requests,
    rateLimit,
    credits
  };
}

/**
 * Normalizes data from the thread GraphQL query into the shape expected by createThreadState.
 * @param {{ thread?: any; messages?: any; actionCards?: any; participants?: any; projectPanel?: any; safeMode?: any; presenceTtlMs?: number }} payload
 */
export function normalizeThreadPayload(payload = {}) {
  const threadSource = payload.thread ?? payload;
  const thread = normalizeThreadHeader(threadSource);
  const safeMode = extractSafeMode(payload.safeMode ?? threadSource.safeMode);

  const messages = asArray(payload.messages ?? threadSource.messages ?? []).map((node) => {
    if (node?.node) return node.node;
    return node;
  });
  const normalizedMessages = messages
    .map((node) => normalizeMessageNode(node, { partial: false }))
    .filter(Boolean);

  const actionCards = asArray(payload.actionCards ?? threadSource.actionCards ?? []).map((node) => {
    if (node?.node) return node.node;
    return node;
  });
  const normalizedActionCards = actionCards.map(normalizeActionCardNode).filter(Boolean);

  const participants = asArray(payload.participants ?? threadSource.participants ?? []).map((node) => {
    if (node?.node) return node.node;
    return node;
  });
  const normalizedParticipants = participants.map(normalizeParticipantNode).filter(Boolean);

  const projectPanel = normalizeProjectPanel(payload.projectPanel ?? threadSource.projectPanel);

  const presenceTtlMs = toNumber(payload.presenceTtlMs ?? threadSource.presenceTtlMs ?? payload.presenceTTL ?? threadSource.presenceTTL, 60 * 1000);

  return {
    thread,
    messages: normalizedMessages,
    actionCards: normalizedActionCards,
    participants: normalizedParticipants,
    projectPanel: projectPanel ?? undefined,
    safeMode,
    presenceTtlMs
  };
}

function canonicalizeEventType(rawType) {
  if (typeof rawType !== 'string') {
    return null;
  }
  let value = rawType.trim();
  if (!value) return null;
  value = value.replace(/Event$/i, '');
  value = value.replace(/_EVENT$/i, '');
  value = value.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  value = value.replace(/__+/g, '_');
  return value.toUpperCase();
}

const THREAD_EVENT_MAP = {
  MESSAGE_CREATED: 'MESSAGE_CREATED',
  MESSAGE_NEW: 'MESSAGE_CREATED',
  MESSAGE_UPDATED: 'MESSAGE_UPDATED',
  MESSAGE_EDITED: 'MESSAGE_UPDATED',
  MESSAGE_FAILED: 'MESSAGE_FAILED',
  MESSAGE_ERROR: 'MESSAGE_FAILED',
  MESSAGE_FLAGGED: 'MESSAGE_MODERATION_UPDATED',
  MESSAGE_REPORTED: 'MESSAGE_MODERATION_UPDATED',
  MESSAGE_MODERATION_UPDATED: 'MESSAGE_MODERATION_UPDATED',
  ACTION_CARD_UPDATED: 'ACTION_CARD_UPSERT',
  ACTION_CARD_CREATED: 'ACTION_CARD_UPSERT',
  ACTION_CARD_UPSERT: 'ACTION_CARD_UPSERT',
  ACTION_CARD_STATE_CHANGED: 'ACTION_CARD_UPSERT',
  ACTION_CARD_PATCHED: 'ACTION_CARD_UPSERT',
  READ_RECEIPT_UPDATED: 'READ_RECEIPT_UPDATED',
  PARTICIPANT_READ_RECEIPT_UPDATED: 'READ_RECEIPT_UPDATED',
  PRESENCE_EVENT: 'PRESENCE_EVENT',
  PRESENCE: 'PRESENCE_EVENT',
  TYPING: 'PRESENCE_EVENT',
  THREAD_STATUS_CHANGED: 'THREAD_STATUS_CHANGED',
  THREAD_STATUS_UPDATED: 'THREAD_STATUS_CHANGED',
  THREAD_LOCK_STATE: 'THREAD_MODERATION_UPDATED',
  THREAD_BLOCK_STATE: 'THREAD_MODERATION_UPDATED',
  THREAD_MODERATION_UPDATED: 'THREAD_MODERATION_UPDATED',
  SAFE_MODE_OVERRIDE: 'SAFE_MODE_OVERRIDE',
  SAFE_MODE_CHANGED: 'SAFE_MODE_OVERRIDE',
  PROJECT_PANEL_UPDATED: 'PROJECT_PANEL_UPDATED',
  PROJECT_PANEL_CHANGE: 'PROJECT_PANEL_UPDATED'
};

/**
 * Maps a GraphQL subscription envelope into a thread_store event.
 * @param {any} envelope
 * @returns {{ type: string; payload?: any }|null}
 */
export function mapThreadEventEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return null;
  }
  const type =
    THREAD_EVENT_MAP[
      canonicalizeEventType(
        pickFirst(envelope.type, envelope.eventType, envelope.__typename, envelope.event?.type, envelope.payload?.type)
      )
    ];
  if (!type) {
    return null;
  }
  switch (type) {
    case 'MESSAGE_CREATED': {
      const message = pickFirst(envelope.message, envelope.payload?.message, envelope.payload, envelope.data);
      const normalized = normalizeMessageNode(message, { partial: false });
      if (!normalized) return null;
      if (envelope.clientId ?? message?.clientId ?? envelope.payload?.clientId) {
        normalized.clientId = envelope.clientId ?? message?.clientId ?? envelope.payload?.clientId;
      }
      return { type, payload: normalized };
    }
    case 'MESSAGE_UPDATED': {
      const message =
        pickFirst(envelope.message, envelope.payload?.message, envelope.payload, envelope.data) ?? envelope;
      const normalized = normalizeMessageNode(message, { partial: true });
      if (!normalized) return null;
      return { type, payload: normalized };
    }
    case 'MESSAGE_MODERATION_UPDATED': {
      const source = pickFirst(envelope.message, envelope.payload?.message, envelope.payload, envelope.data);
      const messageId = toStringId(pickFirst(source?.messageId, source?.id, envelope.messageId));
      if (!messageId) {
        return null;
      }
      const moderation =
        source?.moderation && typeof source.moderation === 'object'
          ? JSON.parse(JSON.stringify(source.moderation))
          : source?.moderation ?? null;
      return {
        type,
        payload: {
          messageId,
          moderation
        }
      };
    }
    case 'MESSAGE_FAILED': {
      const payload = {
        clientId: pickFirst(envelope.clientId, envelope.payload?.clientId, envelope.data?.clientId),
        errorCode: pickFirst(envelope.errorCode, envelope.payload?.errorCode, envelope.data?.errorCode)
      };
      if (!payload.clientId) return null;
      return { type, payload };
    }
    case 'ACTION_CARD_UPSERT': {
      const actionCard = pickFirst(envelope.actionCard, envelope.payload?.actionCard, envelope.payload, envelope.data);
      const normalized = normalizeActionCardNode(actionCard);
      if (!normalized) return null;
      return { type, payload: normalized };
    }
    case 'READ_RECEIPT_UPDATED': {
      const receipt = pickFirst(envelope.readReceipt, envelope.payload?.readReceipt, envelope.payload, envelope.data);
      if (!receipt || typeof receipt !== 'object') return null;
      return {
        type,
        payload: {
          userId: toStringId(pickFirst(receipt.userId, receipt.participantId)),
          role: (receipt.role ?? receipt.participantRole ?? 'participant').toUpperCase(),
          lastReadMsgId: receipt.lastReadMsgId ?? receipt.lastReadMessageId ?? null,
          lastReadAt: receipt.lastReadAt ? toIso(receipt.lastReadAt) : null
        }
      };
    }
    case 'PRESENCE_EVENT': {
      const presence = pickFirst(envelope.presence, envelope.payload?.presence, envelope.payload, envelope.data);
      if (!presence || typeof presence !== 'object') return null;
      const userId = toStringId(pickFirst(presence.userId, presence.participantId));
      if (!userId) return null;
      return {
        type,
        payload: {
          userId,
          lastSeen: presence.lastSeen ? toIso(presence.lastSeen) : undefined,
          typing: toBoolean(presence.typing ?? presence.isTyping)
        }
      };
    }
    case 'THREAD_STATUS_CHANGED': {
      const statusPayload = pickFirst(envelope.payload, envelope.data, envelope.thread);
      return {
        type,
        payload: {
          status: (statusPayload?.status ?? statusPayload?.thread?.status ?? 'OPEN').toUpperCase()
        }
      };
    }
    case 'THREAD_MODERATION_UPDATED': {
      const source = pickFirst(envelope.thread, envelope.payload?.thread, envelope.payload, envelope.data);
      const threadId = toStringId(pickFirst(source?.threadId, source?.id, envelope.threadId));
      if (!threadId) {
        return null;
      }
      const moderation =
        source?.moderation && typeof source.moderation === 'object'
          ? JSON.parse(JSON.stringify(source.moderation))
          : source?.moderation ?? null;
      return {
        type,
        payload: {
          threadId,
          moderation,
          status: source?.status ?? source?.state
        }
      };
    }
    case 'SAFE_MODE_OVERRIDE': {
      const safeMode = pickFirst(envelope.safeMode, envelope.payload?.safeMode, envelope.payload, envelope.data);
      if (!safeMode || typeof safeMode !== 'object') return null;
      return {
        type,
        payload: {
          override: toBoolean(safeMode.override ?? safeMode.hasOverride),
          bandMax: safeMode.bandMax ?? safeMode.band ?? safeMode.nsfwBandMax
        }
      };
    }
    case 'PROJECT_PANEL_UPDATED': {
      const panel = pickFirst(envelope.projectPanel, envelope.payload?.projectPanel, envelope.payload, envelope.data);
      if (!panel || typeof panel !== 'object') return null;
      return {
        type,
        payload: {
          version: toNumber(pickFirst(panel.version, panel.revision), 0),
          tabs: panel.tabs && typeof panel.tabs === 'object' ? { ...panel.tabs } : {}
        }
      };
    }
    default:
      return null;
  }
}

const INBOX_EVENT_MAP = {
  THREAD_CREATED: 'THREAD_CREATED',
  THREAD_NEW: 'THREAD_CREATED',
  THREAD_UPDATED: 'THREAD_UPDATED',
  THREAD_EDITED: 'THREAD_UPDATED',
  THREAD_MESSAGE_RECEIVED: 'THREAD_MESSAGE_RECEIVED',
  THREAD_MESSAGE: 'THREAD_MESSAGE_RECEIVED',
  THREAD_PINNED: 'THREAD_PINNED',
  THREAD_UNPINNED: 'THREAD_UNPINNED',
  THREAD_ARCHIVED: 'THREAD_ARCHIVED',
  THREAD_UNARCHIVED: 'THREAD_UNARCHIVED',
  THREAD_MUTED: 'THREAD_MUTED',
  THREAD_UNMUTED: 'THREAD_MUTED',
  THREAD_BLOCKED: 'THREAD_BLOCKED',
  THREAD_UNBLOCKED: 'THREAD_UNBLOCKED',
  THREAD_READ: 'THREAD_READ',
  REQUEST_RECEIVED: 'REQUEST_RECEIVED',
  MESSAGE_REQUEST_CREATED: 'REQUEST_RECEIVED'
};

/**
 * Maps a GraphQL inbox subscription envelope into an inbox_store event.
 * @param {any} envelope
 * @returns {{ type: string; payload?: any }|null}
 */
export function mapInboxEventEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return null;
  }
  const type =
    INBOX_EVENT_MAP[
      canonicalizeEventType(
        pickFirst(envelope.type, envelope.eventType, envelope.__typename, envelope.event?.type, envelope.payload?.type)
      )
    ];
  if (!type) {
    return null;
  }
  switch (type) {
    case 'THREAD_CREATED':
    case 'THREAD_UPDATED': {
      const thread = pickFirst(envelope.thread, envelope.payload?.thread, envelope.payload, envelope.data);
      if (!thread) return null;
      const normalized = normalizeInboxPayload({ threads: [thread] }).threads[0];
      if (!normalized) return null;
      return {
        type,
        payload: normalized
      };
    }
    case 'THREAD_MESSAGE_RECEIVED': {
      const payload = pickFirst(envelope.payload, envelope.data);
      const threadId = toStringId(pickFirst(payload?.threadId, payload?.thread?.threadId));
      if (!threadId) return null;
      return {
        type,
        payload: {
          threadId,
          lastMessageAt: toIso(pickFirst(payload?.lastMessageAt, payload?.message?.createdAt)),
          incrementUnread: toNumber(payload?.incrementUnread ?? payload?.unreadDelta ?? 1, 1)
        }
      };
    }
    case 'THREAD_PINNED':
    case 'THREAD_UNPINNED':
    case 'THREAD_ARCHIVED':
    case 'THREAD_UNARCHIVED':
    case 'THREAD_MUTED':
    case 'THREAD_BLOCKED':
    case 'THREAD_UNBLOCKED': {
      const payload = pickFirst(envelope.payload, envelope.data);
      const threadId = toStringId(pickFirst(payload?.threadId, payload?.thread?.threadId));
      if (!threadId) return null;
      return {
        type,
        payload: {
          threadId,
          muted: type === 'THREAD_MUTED' ? toBoolean(payload?.muted ?? payload?.isMuted) : undefined,
          blocked: type === 'THREAD_BLOCKED' ? true : type === 'THREAD_UNBLOCKED' ? false : undefined,
          status: payload?.status ?? payload?.thread?.status ?? undefined,
          moderation:
            payload?.moderation && typeof payload.moderation === 'object'
              ? JSON.parse(JSON.stringify(payload.moderation))
              : undefined
        }
      };
    }
    case 'THREAD_READ': {
      const payload = pickFirst(envelope.payload, envelope.data);
      const threadId = toStringId(pickFirst(payload?.threadId, payload?.thread?.threadId));
      if (!threadId) return null;
      return { type, payload: { threadId } };
    }
    case 'REQUEST_RECEIVED': {
      const request = pickFirst(envelope.request, envelope.payload?.request, envelope.payload, envelope.data);
      const normalized = normalizeMessageRequestNode(request);
      if (!normalized) return null;
      return {
        type,
        payload: normalized
      };
    }
    default:
      return null;
  }
}

/**
 * Hydrates a messaging controller from GraphQL query payloads.
 * @param {import('./controller.mjs').createMessagingController} controller
 * @param {{ inbox?: any; threads?: any[] }} options
 */
export function hydrateControllerFromGraphQL(controller, options = {}) {
  if (!controller || typeof controller.hydrateInbox !== 'function') {
    throw new Error('hydrateControllerFromGraphQL requires a messaging controller instance');
  }
  if (options.inbox) {
    const inboxPayload = normalizeInboxPayload(options.inbox);
    controller.hydrateInbox(inboxPayload);
  }
  if (Array.isArray(options.threads)) {
    for (const threadNode of options.threads) {
      if (!threadNode) continue;
      const normalized = normalizeThreadPayload(threadNode);
      controller.hydrateThread(normalized, { syncInbox: true });
    }
  }
  return controller;
}
