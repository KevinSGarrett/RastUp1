const SEVERITY_ORDER = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 3
};

function normalizeSeverity(value) {
  if (!value) return 'NORMAL';
  const upper = value.toUpperCase();
  return SEVERITY_ORDER[upper] !== undefined ? upper : 'NORMAL';
}

function parseTimeString(input) {
  if (!input || typeof input !== 'string') return null;
  const [hours, minutes] = input.split(':').map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

function getMinutesOfDay(dateLike, offsetMinutes = 0) {
  const date = new Date(dateLike);
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const minutes = (utcMinutes + offsetMinutes + 1440) % 1440;
  return minutes;
}

function withinInterval(minutes, start, end) {
  if (start === null || end === null) {
    return false;
  }
  if (start === end) {
    return true;
  }
  if (start < end) {
    return minutes >= start && minutes < end;
  }
  return minutes >= start || minutes < end;
}

function cloneState(state) {
  return {
    itemsById: Object.fromEntries(Object.entries(state.itemsById).map(([id, item]) => [id, { ...item }])),
    order: [...state.order],
    dedupe: { ...state.dedupe },
    quietHours: { ...state.quietHours },
    dedupeWindowMs: state.dedupeWindowMs,
    digestWindowMs: state.digestWindowMs,
    maxItems: state.maxItems,
    lastUpdatedAt: state.lastUpdatedAt
  };
}

function createQueueItem(notification, nowIso, severity, key, deferred) {
  return {
    id: notification.id ?? `${key}:${nowIso}`,
    key,
    threadId: notification.threadId ?? null,
    type: notification.type ?? notification.kind ?? 'generic',
    severity,
    message: notification.message ?? null,
    data: notification.data ? { ...notification.data } : {},
    count: notification.count ?? 1,
    deferred,
    createdAt: nowIso,
    updatedAt: nowIso,
    digestNotifiedAt: null
  };
}

function ensureCapacity(state) {
  if (state.order.length <= state.maxItems) {
    return;
  }
  const dropId = state.order.shift();
  if (dropId) {
    const dropped = state.itemsById[dropId];
    delete state.itemsById[dropId];
    if (dropped) {
      delete state.dedupe[dropped.key];
    }
  }
}

/**
 * Creates a notification queue state.
 * @param {{
 *   quietHours?: { start?: string; end?: string; timezoneOffsetMinutes?: number; bypassSeverities?: string[] };
 *   dedupeWindowMs?: number;
 *   digestWindowMs?: number;
 *   maxItems?: number;
 * }} [options]
 */
export function createNotificationQueue(options = {}) {
  const quietConfig = options.quietHours ?? {};
  const bypass = new Set(
    Array.isArray(quietConfig.bypassSeverities)
      ? quietConfig.bypassSeverities.map((value) => normalizeSeverity(value))
      : ['CRITICAL']
  );
  return {
    itemsById: {},
    order: [],
    dedupe: {},
    quietHours: {
      startMinutes: quietConfig.start ? parseTimeString(quietConfig.start) : null,
      endMinutes: quietConfig.end ? parseTimeString(quietConfig.end) : null,
      timezoneOffsetMinutes: quietConfig.timezoneOffsetMinutes ?? 0,
      bypassSeverities: bypass
    },
    dedupeWindowMs: typeof options.dedupeWindowMs === 'number' ? options.dedupeWindowMs : 2 * 60 * 1000,
    digestWindowMs: typeof options.digestWindowMs === 'number' ? options.digestWindowMs : 10 * 60 * 1000,
    maxItems: typeof options.maxItems === 'number' ? options.maxItems : 200,
    lastUpdatedAt: Date.now()
  };
}

/**
 * Determines whether the current time falls within quiet hours.
 * @param {ReturnType<typeof createNotificationQueue>} state
 * @param {{ now?: number }} [options]
 */
export function isWithinQuietHours(state, options = {}) {
  const start = state.quietHours.startMinutes;
  const end = state.quietHours.endMinutes;
  if (start === null || end === null) {
    return false;
  }
  const now = options.now ?? Date.now();
  const minutes = getMinutesOfDay(now, state.quietHours.timezoneOffsetMinutes ?? 0);
  return withinInterval(minutes, start, end);
}

function shouldDefer(state, severity, options) {
  if (!isWithinQuietHours(state, options)) {
    return false;
  }
  return !state.quietHours.bypassSeverities.has(severity);
}

/**
 * Adds a notification to the queue (deduping if within window).
 * @param {ReturnType<typeof createNotificationQueue>} state
 * @param {{
 *   key?: string;
 *   dedupeKey?: string;
 *   threadId?: string;
 *   type?: string;
 *   kind?: string;
 *   severity?: string;
 *   message?: string;
 *   data?: Record<string, any>;
 *   id?: string;
 * }} notification
 * @param {{ now?: number }} [options]
 */
export function enqueueNotification(state, notification, options = {}) {
  const now = options.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const severity = normalizeSeverity(notification.severity);
  const key =
    notification.dedupeKey ??
    notification.key ??
    `${notification.threadId ?? 'global'}:${notification.type ?? notification.kind ?? 'generic'}`;

  const next = cloneState(state);
  next.lastUpdatedAt = now;

  const existingRecord = next.dedupe[key];
  if (existingRecord && now - existingRecord.lastSeen <= next.dedupeWindowMs) {
    const existingItem = next.itemsById[existingRecord.itemId];
    if (existingItem) {
      existingItem.count += notification.count ?? 1;
      existingItem.updatedAt = nowIso;
      if (SEVERITY_ORDER[severity] > SEVERITY_ORDER[existingItem.severity]) {
        existingItem.severity = severity;
      }
      if (notification.message) {
        existingItem.message = notification.message;
      }
      existingItem.data = { ...existingItem.data, ...(notification.data ?? {}) };
      existingItem.deferred = existingItem.deferred && shouldDefer(next, existingItem.severity, { now });
      existingRecord.lastSeen = now;
      return next;
    }
  }

  const deferred = shouldDefer(next, severity, { now });
  const item = createQueueItem(notification, nowIso, severity, key, deferred);
  next.itemsById[item.id] = item;
  next.order.push(item.id);
  next.dedupe[key] = { itemId: item.id, lastSeen: now };
  ensureCapacity(next);
  return next;
}

/**
 * Releases notifications that are ready to display.
 * Removes delivered notifications from the queue.
 * @param {ReturnType<typeof createNotificationQueue>} state
 * @param {{ now?: number }} [options]
 */
export function flushNotifications(state, options = {}) {
  const now = options.now ?? Date.now();
  const next = cloneState(state);
  const ready = [];
  const remainingOrder = [];
  const currentQuiet = isWithinQuietHours(next, { now });

  for (const id of next.order) {
    const item = next.itemsById[id];
    if (!item) {
      continue;
    }

    if (item.deferred && !currentQuiet) {
      item.deferred = false;
    }

    if (!item.deferred) {
      ready.push(item);
      delete next.itemsById[id];
      delete next.dedupe[item.key];
    } else {
      remainingOrder.push(id);
    }
  }

  next.order = remainingOrder;
  next.lastUpdatedAt = now;
  return { state: next, notifications: ready };
}

/**
 * Produces digest summaries for deferred notifications that have waited beyond the digest window.
 * Marks items as having contributed to a digest to avoid duplicate summaries.
 * @param {ReturnType<typeof createNotificationQueue>} state
 * @param {{ now?: number }} [options]
 */
export function collectDigest(state, options = {}) {
  const now = options.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const summaries = new Map();

  for (const item of Object.values(state.itemsById)) {
    if (!item.deferred) {
      continue;
    }
    const createdTs = Date.parse(item.createdAt ?? 0) || 0;
    if (now - createdTs < state.digestWindowMs) {
      continue;
    }
    if (item.digestNotifiedAt) {
      const notifiedTs = Date.parse(item.digestNotifiedAt) || 0;
      if (notifiedTs >= createdTs && now - notifiedTs < state.digestWindowMs / 2) {
        continue;
      }
    }

    const key = item.threadId ?? 'global';
    const entry = summaries.get(key) ?? {
      threadId: item.threadId ?? null,
      count: 0,
      highestSeverity: item.severity,
      firstAt: item.createdAt,
      lastAt: item.updatedAt,
      sampleMessages: new Set()
    };

    entry.count += item.count;
    entry.lastAt = item.updatedAt > entry.lastAt ? item.updatedAt : entry.lastAt;
    entry.firstAt = item.createdAt < entry.firstAt ? item.createdAt : entry.firstAt;
    if (SEVERITY_ORDER[item.severity] > SEVERITY_ORDER[entry.highestSeverity]) {
      entry.highestSeverity = item.severity;
    }
    if (item.message) {
      entry.sampleMessages.add(item.message);
    }
    summaries.set(key, entry);
    item.digestNotifiedAt = nowIso;
  }

  return Array.from(summaries.values()).map((entry) => ({
    threadId: entry.threadId,
    count: entry.count,
    highestSeverity: entry.highestSeverity,
    firstAt: entry.firstAt,
    lastAt: entry.lastAt,
    sampleMessages: Array.from(entry.sampleMessages).slice(0, 3)
  }));
}

/**
 * Returns the pending notifications (for inspection/testing).
 * @param {ReturnType<typeof createNotificationQueue>} state
 */
export function listPendingNotifications(state) {
  return state.order.map((id) => state.itemsById[id]).filter(Boolean);
}
