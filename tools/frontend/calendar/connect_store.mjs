function cloneSources(sources = []) {
  return sources.map((source) => ({ ...source }));
}

function buildIndex(sources) {
  const orderedSourceIds = [];
  const sourcesById = {};
  for (const source of sources) {
    orderedSourceIds.push(source.srcId);
    sourcesById[source.srcId] = { ...source };
  }
  return { orderedSourceIds, sourcesById };
}

function nowIso() {
  return new Date().toISOString();
}

function snapshot(state) {
  return {
    sourcesById: Object.fromEntries(
      Object.entries(state.sourcesById).map(([key, value]) => [key, { ...value }])
    ),
    orderedSourceIds: [...state.orderedSourceIds],
    feed: state.feed ? { ...state.feed } : null,
    pendingUrl: state.pendingUrl,
    telemetry: [...state.telemetry],
    errorLog: [...state.errorLog],
    syncSummary: Object.fromEntries(
      Object.entries(state.syncSummary).map(([key, value]) => [key, { ...value }])
    ),
    lastUpdatedAt: state.lastUpdatedAt
  };
}

export function createCalendarConnectStore(initial = {}) {
  const initialSources = cloneSources(initial.sources ?? []);
  initialSources.sort((a, b) => {
    const left = Date.parse(b.createdAt ?? 0) || 0;
    const right = Date.parse(a.createdAt ?? 0) || 0;
    return left - right;
  });

  const { orderedSourceIds, sourcesById } = buildIndex(initialSources);

  const state = {
    sourcesById,
    orderedSourceIds,
    feed: initial.feed ? { ...initial.feed } : null,
    pendingUrl: null,
    telemetry: [],
    errorLog: [],
    syncSummary: {},
    lastUpdatedAt: nowIso()
  };

  const listeners = new Set();

  function notify() {
    const snap = snapshot(state);
    for (const listener of listeners) {
      listener(snap);
    }
    return snap;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getState() {
    return snapshot(state);
  }

  function setPendingUrl(url) {
    state.pendingUrl = url ?? null;
    state.lastUpdatedAt = nowIso();
    return notify();
  }

  function hydrateSources(sources = []) {
    const next = cloneSources(sources);
    next.sort((a, b) => {
      const left = Date.parse(b.createdAt ?? 0) || 0;
      const right = Date.parse(a.createdAt ?? 0) || 0;
      return left - right;
    });
    const index = buildIndex(next);
    state.sourcesById = index.sourcesById;
    state.orderedSourceIds = index.orderedSourceIds;
    state.lastUpdatedAt = nowIso();
    return notify();
  }

  function upsertSource(source) {
    if (!source || !source.srcId) {
      throw new Error('source must include srcId');
    }
    if (!state.sourcesById[source.srcId]) {
      state.orderedSourceIds.unshift(source.srcId);
    }
    state.sourcesById[source.srcId] = {
      status: 'active',
      ...state.sourcesById[source.srcId],
      ...source
    };
    state.lastUpdatedAt = nowIso();
    return notify();
  }

  function removeSource(srcId) {
    if (!state.sourcesById[srcId]) {
      return getState();
    }
    delete state.sourcesById[srcId];
    state.orderedSourceIds = state.orderedSourceIds.filter((id) => id !== srcId);
    delete state.syncSummary[srcId];
    state.lastUpdatedAt = nowIso();
    return notify();
  }

  function markSyncResult(result) {
    const { srcId, status = 'ok', fetchedAt = nowIso(), eventCount = 0 } = result ?? {};
    if (!srcId || !state.sourcesById[srcId]) {
      throw new Error('markSyncResult requires known srcId');
    }
    const summary = state.syncSummary[srcId] ?? {
      okCount: 0,
      errorCount: 0,
      lastEventCount: 0,
      lastError: null,
      lastSyncAt: null
    };
    if (status === 'ok') {
      summary.okCount += 1;
      summary.lastError = null;
    } else {
      summary.errorCount += 1;
      summary.lastError = {
        message: result?.error?.message ?? 'Unknown error',
        retriable: Boolean(result?.error?.retriable),
        occurredAt: fetchedAt
      };
    }
    summary.lastSyncAt = fetchedAt;
    summary.lastEventCount = eventCount;
    state.syncSummary[srcId] = summary;
    state.sourcesById[srcId] = {
      ...state.sourcesById[srcId],
      lastPollAt: fetchedAt,
      status: status === 'ok' ? 'active' : 'error',
      lastImportedCount: eventCount
    };
    state.lastUpdatedAt = nowIso();
    return notify();
  }

  function recordError(error) {
    const entry = {
      sourceId: error?.srcId ?? null,
      message: error?.message ?? 'Unknown calendar error',
      retriable: Boolean(error?.retriable),
      occurredAt: nowIso()
    };
    state.errorLog.unshift(entry);
    if (state.errorLog.length > 50) {
      state.errorLog.pop();
    }
    state.lastUpdatedAt = nowIso();
    return notify();
  }

  function recordTelemetry(event) {
    const entry = {
      ...event,
      occurredAt: event?.occurredAt ?? nowIso()
    };
    state.telemetry.unshift(entry);
    if (state.telemetry.length > 100) {
      state.telemetry.pop();
    }
    state.lastUpdatedAt = nowIso();
    return notify();
  }

  function setFeed(feed) {
    state.feed = feed ? { ...feed, updatedAt: nowIso() } : null;
    state.lastUpdatedAt = nowIso();
    return notify();
  }

  return {
    subscribe,
    getState,
    setPendingUrl,
    hydrateSources,
    upsertSource,
    removeSource,
    markSyncResult,
    recordError,
    recordTelemetry,
    setFeed
  };
}
