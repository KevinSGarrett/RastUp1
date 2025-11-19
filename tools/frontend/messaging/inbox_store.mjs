const DEFAULT_RATE_LIMIT = {
  windowMs: 24 * 60 * 60 * 1000, // 24h
  maxConversations: 5
};

const DEFAULT_CREDITS = {
  available: Infinity,
  costPerRequest: 0,
  floor: 0
};

/**
 * Creates a normalized inbox state tree.
 * @param {{
 *   threads?: Array<{
 *     threadId: string;
 *     lastMessageAt: string;
 *     unreadCount?: number;
 *     pinned?: boolean;
 *     archived?: boolean;
 *     muted?: boolean;
 *     kind: 'INQUIRY'|'PROJECT';
 *     safeModeRequired?: boolean;
 *   }>;
 *   requests?: Array<{
 *     requestId: string;
 *     threadId: string;
 *     creditCost: number;
 *     expiresAt: string;
 *     createdAt: string;
 *   }>;
 *   rateLimit?: { windowMs?: number; maxConversations?: number; initiations?: number[] };
 *   credits?: { available?: number; costPerRequest?: number; floor?: number };
 * }} opts
 */
export function createInboxState(opts = {}) {
  const threads = Array.isArray(opts.threads) ? opts.threads : [];
  const requests = Array.isArray(opts.requests) ? opts.requests : [];
  const rateLimit = {
    windowMs: opts.rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT.windowMs,
    maxConversations: opts.rateLimit?.maxConversations ?? DEFAULT_RATE_LIMIT.maxConversations,
    initiations: Array.isArray(opts.rateLimit?.initiations) ? [...opts.rateLimit.initiations] : []
  };
  const credits = {
    available: opts.credits?.available ?? DEFAULT_CREDITS.available,
    costPerRequest: opts.credits?.costPerRequest ?? DEFAULT_CREDITS.costPerRequest,
    floor: opts.credits?.floor ?? DEFAULT_CREDITS.floor
  };

  const sortedThreads = [...threads].sort((a, b) => {
    const aTime = Date.parse(a.lastMessageAt ?? 0) || 0;
    const bTime = Date.parse(b.lastMessageAt ?? 0) || 0;
    return bTime - aTime;
  });

  const threadsById = {};
  const orderedThreadIds = [];
  const pinnedThreadIds = [];
  const archivedThreadIds = [];
  const unreadByThreadId = {};

  for (const thread of sortedThreads) {
    if (!thread?.threadId) {
      continue;
    }
    const normalized = {
      ...thread,
      threadId: thread.threadId,
      lastMessageAt: thread.lastMessageAt,
      unreadCount: thread.unreadCount ?? 0,
      pinned: Boolean(thread.pinned),
      archived: Boolean(thread.archived),
      muted: Boolean(thread.muted),
      safeModeRequired: Boolean(thread.safeModeRequired)
    };
    if (normalized.title && typeof normalized.title !== 'string') {
      normalized.title = String(normalized.title);
    }
    if (normalized.subtitle && typeof normalized.subtitle !== 'string') {
      normalized.subtitle = String(normalized.subtitle);
    }
    if (normalized.labels && !Array.isArray(normalized.labels)) {
      normalized.labels = [normalized.labels].filter((value) => value != null);
    } else if (Array.isArray(normalized.labels)) {
      normalized.labels = normalized.labels.map((value) => (value == null ? value : String(value)));
    }
    if (normalized.metadata && typeof normalized.metadata === 'object') {
      normalized.metadata = { ...normalized.metadata };
    }
    threadsById[thread.threadId] = normalized;
    orderedThreadIds.push(thread.threadId);
    if (thread.pinned) {
      pinnedThreadIds.push(thread.threadId);
    }
    if (thread.archived) {
      archivedThreadIds.push(thread.threadId);
    }
    unreadByThreadId[thread.threadId] = thread.unreadCount ?? 0;
  }

  const requestsById = {};
  const requestOrder = [];
  for (const req of [...requests].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    requestsById[req.requestId] = { ...req, status: 'PENDING' };
    requestOrder.push(req.requestId);
  }

  return {
    threadsById,
    orderedThreadIds,
    pinnedThreadIds,
    archivedThreadIds,
    unreadByThreadId,
    requestsById,
    requestOrder,
    credits,
    rateLimit,
    lastUpdatedAt: Date.now()
  };
}

function cloneState(state) {
  return {
    threadsById: { ...state.threadsById },
    orderedThreadIds: [...state.orderedThreadIds],
    pinnedThreadIds: [...state.pinnedThreadIds],
    archivedThreadIds: [...state.archivedThreadIds],
    unreadByThreadId: { ...state.unreadByThreadId },
    requestsById: { ...state.requestsById },
    requestOrder: [...state.requestOrder],
    credits: { ...state.credits },
    rateLimit: {
      windowMs: state.rateLimit.windowMs,
      maxConversations: state.rateLimit.maxConversations,
      initiations: [...state.rateLimit.initiations]
    },
    lastUpdatedAt: state.lastUpdatedAt
  };
}

function ensureThread(state, thread) {
  const next = cloneState(state);
  if (!next.threadsById[thread.threadId]) {
    next.orderedThreadIds.unshift(thread.threadId);
  }
  next.threadsById[thread.threadId] = {
    ...next.threadsById[thread.threadId],
    ...thread
  };
  if (!next.orderedThreadIds.includes(thread.threadId)) {
    next.orderedThreadIds.unshift(thread.threadId);
  }
  next.unreadByThreadId[thread.threadId] = thread.unreadCount ?? next.unreadByThreadId[thread.threadId] ?? 0;
  if (thread.pinned && !next.pinnedThreadIds.includes(thread.threadId)) {
    next.pinnedThreadIds.push(thread.threadId);
  }
  if (!thread.pinned && next.pinnedThreadIds.includes(thread.threadId)) {
    next.pinnedThreadIds = next.pinnedThreadIds.filter((id) => id !== thread.threadId);
  }
  if (thread.archived && !next.archivedThreadIds.includes(thread.threadId)) {
    next.archivedThreadIds.push(thread.threadId);
  }
  if (!thread.archived && next.archivedThreadIds.includes(thread.threadId)) {
    next.archivedThreadIds = next.archivedThreadIds.filter((id) => id !== thread.threadId);
  }
  next.lastUpdatedAt = Date.now();
  return next;
}

function reorderThread(state, threadId, lastMessageAt) {
  const next = cloneState(state);
  next.orderedThreadIds = next.orderedThreadIds.filter((id) => id !== threadId);
  const targetTime = Date.parse(lastMessageAt ?? 0) || 0;
  let inserted = false;
  for (let i = 0; i < next.orderedThreadIds.length; i += 1) {
    const currentId = next.orderedThreadIds[i];
    const currentThread = next.threadsById[currentId];
    const currentTime = Date.parse(currentThread?.lastMessageAt ?? 0) || 0;
    if (targetTime >= currentTime) {
      next.orderedThreadIds.splice(i, 0, threadId);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    next.orderedThreadIds.push(threadId);
  }
  next.threadsById[threadId] = {
    ...next.threadsById[threadId],
    lastMessageAt
  };
  next.lastUpdatedAt = Date.now();
  return next;
}

/**
 * Applies an inbox-level event and returns updated state.
 * @param {ReturnType<typeof createInboxState>} state
 * @param {{ type: string; payload?: any }} event
 */
export function applyInboxEvent(state, event) {
  switch (event?.type) {
    case 'THREAD_CREATED':
      return ensureThread(state, {
        ...event.payload,
        unreadCount: event.payload.unreadCount ?? 0
      });
    case 'THREAD_UPDATED': {
      const merged = { ...state.threadsById[event.payload.threadId], ...event.payload };
      const next = ensureThread(state, merged);
      if (event.payload.lastMessageAt) {
        return reorderThread(next, event.payload.threadId, event.payload.lastMessageAt);
      }
      return next;
    }
    case 'THREAD_READ': {
      if (!state.threadsById[event.payload.threadId]) {
        return state;
      }
      const next = cloneState(state);
      next.unreadByThreadId[event.payload.threadId] = 0;
      next.threadsById[event.payload.threadId] = {
        ...next.threadsById[event.payload.threadId],
        unreadCount: 0
      };
      next.lastUpdatedAt = Date.now();
      return next;
    }
    case 'THREAD_PINNED': {
      if (!state.threadsById[event.payload.threadId]) {
        return state;
      }
      const next = cloneState(state);
      if (!next.pinnedThreadIds.includes(event.payload.threadId)) {
        next.pinnedThreadIds.push(event.payload.threadId);
      }
      next.threadsById[event.payload.threadId] = {
        ...next.threadsById[event.payload.threadId],
        pinned: true
      };
      next.lastUpdatedAt = Date.now();
      return next;
    }
    case 'THREAD_UNPINNED': {
      if (!state.threadsById[event.payload.threadId]) {
        return state;
      }
      const next = cloneState(state);
      next.pinnedThreadIds = next.pinnedThreadIds.filter((id) => id !== event.payload.threadId);
      next.threadsById[event.payload.threadId] = {
        ...next.threadsById[event.payload.threadId],
        pinned: false
      };
      next.lastUpdatedAt = Date.now();
      return next;
    }
    case 'THREAD_ARCHIVED': {
      if (!state.threadsById[event.payload.threadId]) {
        return state;
      }
      const next = cloneState(state);
      if (!next.archivedThreadIds.includes(event.payload.threadId)) {
        next.archivedThreadIds.push(event.payload.threadId);
      }
      next.threadsById[event.payload.threadId] = {
        ...next.threadsById[event.payload.threadId],
        archived: true
      };
      next.lastUpdatedAt = Date.now();
      return next;
    }
    case 'THREAD_UNARCHIVED': {
      if (!state.threadsById[event.payload.threadId]) {
        return state;
      }
      const next = cloneState(state);
      next.archivedThreadIds = next.archivedThreadIds.filter((id) => id !== event.payload.threadId);
      next.threadsById[event.payload.threadId] = {
        ...next.threadsById[event.payload.threadId],
        archived: false
      };
      next.lastUpdatedAt = Date.now();
      return next;
    }
    case 'THREAD_MUTED': {
      if (!state.threadsById[event.payload.threadId]) {
        return state;
      }
      const next = cloneState(state);
      next.threadsById[event.payload.threadId] = {
        ...next.threadsById[event.payload.threadId],
        muted: Boolean(event.payload.muted)
      };
      next.lastUpdatedAt = Date.now();
      return next;
    }
    case 'THREAD_MESSAGE_RECEIVED': {
      if (!state.threadsById[event.payload.threadId]) {
        return state;
      }
      const next = reorderThread(state, event.payload.threadId, event.payload.lastMessageAt);
      const unread = next.unreadByThreadId[event.payload.threadId] ?? 0;
      next.unreadByThreadId[event.payload.threadId] = unread + (event.payload.incrementUnread ?? 1);
      next.threadsById[event.payload.threadId] = {
        ...next.threadsById[event.payload.threadId],
        lastMessageAt: event.payload.lastMessageAt,
        unreadCount: next.unreadByThreadId[event.payload.threadId]
      };
      next.lastUpdatedAt = Date.now();
      return next;
    }
    case 'REQUEST_RECEIVED': {
      const next = cloneState(state);
      const request = {
        requestId: event.payload.requestId,
        threadId: event.payload.threadId,
        creditCost: event.payload.creditCost,
        expiresAt: event.payload.expiresAt,
        createdAt: event.payload.createdAt,
        status: 'PENDING'
      };
      next.requestsById[request.requestId] = request;
      if (!next.requestOrder.includes(request.requestId)) {
        next.requestOrder.push(request.requestId);
      }
      next.lastUpdatedAt = Date.now();
      return next;
    }
    default:
      return state;
  }
}

function pruneRateLimit(rateLimit, now) {
  const cutoff = now - rateLimit.windowMs;
  return rateLimit.initiations.filter((ts) => ts >= cutoff).sort((a, b) => a - b);
}

/**
 * Checks whether a member can start a new conversation.
 * @param {ReturnType<typeof createInboxState>} state
 * @param {{ now: number; requiredCredits?: number }} ctx
 */
export function canStartConversation(state, ctx) {
  const now = ctx?.now ?? Date.now();
  const requiredCredits = ctx?.requiredCredits ?? state.credits.costPerRequest ?? 0;
  if (state.credits.available < requiredCredits) {
    return {
      allowed: false,
      reason: 'INSUFFICIENT_CREDITS',
      availableCredits: state.credits.available,
      requiredCredits
    };
  }
  const pruned = pruneRateLimit(state.rateLimit, now);
  const attempts = pruned.length;
  if (attempts >= state.rateLimit.maxConversations) {
    const nextAllowedAt = pruned[0] + state.rateLimit.windowMs;
    return {
      allowed: false,
      reason: 'RATE_LIMIT_EXCEEDED',
      nextAllowedAt
    };
  }
  return { allowed: true, remaining: state.rateLimit.maxConversations - attempts };
}

/**
 * Records a conversation initiation (credits + rate limit accounting).
 * Pure function returning updated state.
 * @param {ReturnType<typeof createInboxState>} state
 * @param {{ now: number; creditsSpent?: number }} ctx
 */
export function recordConversationStart(state, ctx) {
  const now = ctx?.now ?? Date.now();
  const creditsSpent = ctx?.creditsSpent ?? state.credits.costPerRequest ?? 0;
  const next = cloneState(state);
  next.rateLimit.initiations = pruneRateLimit(next.rateLimit, now);
  next.rateLimit.initiations.push(now);
  next.credits.available = Math.max(next.credits.floor, next.credits.available - creditsSpent);
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Accepts a message request and moves thread into the default inbox.
 * @param {ReturnType<typeof createInboxState>} state
 * @param {string} requestId
 * @param {{ now?: number }} ctx
 */
export function acceptMessageRequest(state, requestId, ctx = {}) {
  const request = state.requestsById[requestId];
  if (!request) {
    return state;
  }
  const now = ctx.now ?? Date.now();
  let next = cloneState(state);
  delete next.requestsById[requestId];
  next.requestOrder = next.requestOrder.filter((id) => id !== requestId);
  next = ensureThread(next, {
    threadId: request.threadId,
    lastMessageAt: new Date(now).toISOString(),
    unreadCount: next.unreadByThreadId[request.threadId] ?? 0,
    archived: false,
    pinned: false
  });
  next.credits.available = Math.max(
    next.credits.floor,
    next.credits.available - (request.creditCost ?? next.credits.costPerRequest ?? 0)
  );
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Declines (or blocks) a message request.
 * @param {ReturnType<typeof createInboxState>} state
 * @param {string} requestId
 * @param {{ block?: boolean }} options
 */
export function declineMessageRequest(state, requestId, options = {}) {
  if (!state.requestsById[requestId]) {
    return state;
  }
  const next = cloneState(state);
  next.requestsById[requestId] = {
    ...next.requestsById[requestId],
    status: options.block ? 'BLOCKED' : 'DECLINED'
  };
  next.lastUpdatedAt = Date.now();
  return next;
}

/**
 * Removes expired requests and returns updated state.
 * @param {ReturnType<typeof createInboxState>} state
 * @param {number} now
 */
export function pruneExpiredRequests(state, now = Date.now()) {
  const next = cloneState(state);
  const order = [];
  for (const requestId of next.requestOrder) {
    const request = next.requestsById[requestId];
    if (!request) continue;
    if (Date.parse(request.expiresAt) <= now || request.status !== 'PENDING') {
      delete next.requestsById[requestId];
      continue;
    }
    order.push(requestId);
  }
  next.requestOrder = order;
  next.lastUpdatedAt = now;
  return next;
}

/**
 * Returns total unread count across all visible threads.
 * @param {ReturnType<typeof createInboxState>} state
 */
export function getTotalUnread(state) {
  return Object.values(state.unreadByThreadId).reduce((sum, count) => sum + (count ?? 0), 0);
}

function normalizeKindSet(kinds) {
  if (!kinds) return null;
  const iterable = Array.isArray(kinds) ? kinds : [kinds];
  const normalized = new Set();
  for (const kind of iterable) {
    if (kind == null) continue;
    normalized.add(String(kind).toUpperCase());
  }
  return normalized.size > 0 ? normalized : null;
}

function defaultQueryMatch(candidate, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  const haystack = [];
  if (candidate.threadId) haystack.push(candidate.threadId);
  if (candidate.kind) haystack.push(candidate.kind);
  if (candidate.status) haystack.push(candidate.status);
  if (candidate.title) haystack.push(candidate.title);
  if (candidate.subtitle) haystack.push(candidate.subtitle);
  if (Array.isArray(candidate.labels)) {
    haystack.push(...candidate.labels);
  }
  const metadata = candidate.metadata;
  if (metadata && typeof metadata === 'object') {
    if (typeof metadata.displayName === 'string') {
      haystack.push(metadata.displayName);
    }
    if (typeof metadata.searchText === 'string') {
      haystack.push(metadata.searchText);
    }
    if (Array.isArray(metadata.searchTokens)) {
      haystack.push(...metadata.searchTokens);
    }
  }
  for (const value of haystack) {
    if (typeof value !== 'string') continue;
    if (value.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns threads filtered by options.
 * @param {ReturnType<typeof createInboxState>} state
 * @param {{
 *   includeArchived?: boolean;
 *   folder?: 'default'|'requests'|'pinned'|'archived';
 *   onlyUnread?: boolean;
 *   kinds?: Iterable<string>|string;
 *   muted?: boolean;
 *   safeModeRequired?: boolean;
 *   query?: string;
 *   queryMatcher?: (thread: any, normalizedQuery: string) => boolean;
 *   predicate?: (thread: any) => boolean;
 * }} options
 */
export function selectThreads(state, options = {}) {
  const includeArchived = options.includeArchived ?? false;
  const onlyUnread = options.onlyUnread ?? false;
  const kindSet = normalizeKindSet(options.kinds);
  const mutedFilter = options.muted;
  const safeModeFilter = options.safeModeRequired;
  const query =
    typeof options.query === 'string' && options.query.trim().length > 0
      ? options.query.trim().toLowerCase()
      : '';
  const queryMatcher = typeof options.queryMatcher === 'function' ? options.queryMatcher : null;
  const predicate = typeof options.predicate === 'function' ? options.predicate : null;

  if (options.folder === 'requests') {
    return state.requestOrder
      .map((requestId) => state.requestsById[requestId])
      .filter((request) => {
        if (!request) return false;
        if (query) {
          const fields = [
            request.requestId,
            request.threadId,
            request.status,
            typeof request.creditCost === 'number' ? String(request.creditCost) : null
          ];
          const matches = fields.some(
            (value) => typeof value === 'string' && value.toLowerCase().includes(query)
          );
          if (!matches) {
            return false;
          }
        }
        return true;
      });
  }

  let candidateIds = state.orderedThreadIds;

  if (options.folder === 'pinned') {
    candidateIds = state.pinnedThreadIds;
  } else if (options.folder === 'archived') {
    candidateIds = state.archivedThreadIds;
  }

  return candidateIds
    .map((threadId) => {
      const thread = state.threadsById[threadId];
      if (!thread) return null;
      if (!includeArchived && thread.archived && options.folder !== 'archived') {
        return null;
      }
      const unreadCount = state.unreadByThreadId[threadId] ?? thread.unreadCount ?? 0;
      const candidate = {
        ...thread,
        unreadCount
      };
      if (onlyUnread && unreadCount === 0) {
        return null;
      }
      if (kindSet) {
        const threadKind = typeof candidate.kind === 'string' ? candidate.kind.toUpperCase() : '';
        if (!kindSet.has(threadKind)) {
          return null;
        }
      }
      if (mutedFilter === true && !candidate.muted) {
        return null;
      }
      if (mutedFilter === false && candidate.muted) {
        return null;
      }
      if (safeModeFilter === true && !candidate.safeModeRequired) {
        return null;
      }
      if (safeModeFilter === false && candidate.safeModeRequired) {
        return null;
      }
      if (query && !(defaultQueryMatch(candidate, query) || (queryMatcher?.(candidate, query) ?? false))) {
        return null;
      }
      if (predicate && !predicate(candidate)) {
        return null;
      }
      return candidate;
    })
    .filter(Boolean);
}
