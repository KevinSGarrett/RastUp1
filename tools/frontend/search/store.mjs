const SURFACES = ['PEOPLE', 'STUDIOS'];
const DEFAULT_SURFACE = 'PEOPLE';
const DEFAULT_SORT = 'RELEVANCE';

const STATUS_IDLE = 'idle';
const STATUS_LOADING = 'loading';
const STATUS_READY = 'ready';
const STATUS_ERROR = 'error';

function cloneResults(results = []) {
  if (!Array.isArray(results)) {
    return [];
  }
  return results.map((result) => ({ ...result }));
}

function cloneFacets(facets = {}) {
  if (!facets || typeof facets !== 'object') {
    return {};
  }
  const cloned = {};
  for (const [facetKey, facetValue] of Object.entries(facets)) {
    if (!facetValue) continue;
    if (Array.isArray(facetValue.options)) {
      cloned[facetKey] = {
        ...facetValue,
        options: facetValue.options.map((option) => ({ ...option }))
      };
    } else {
      cloned[facetKey] = { ...facetValue };
    }
  }
  return cloned;
}

function cloneFilters(filters = {}) {
  if (!filters || typeof filters !== 'object') {
    return {};
  }
  const output = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      output[key] = value.map((item) => (item && typeof item === 'object' ? { ...item } : item));
    } else if (typeof value === 'object') {
      output[key] = { ...value };
    } else {
      output[key] = value;
    }
  }
  return output;
}

function snapshotState(state) {
  return {
    surface: state.surface,
    query: state.query,
    safeMode: state.safeMode,
    sort: state.sort,
    status: state.status,
    error: state.error,
    filters: cloneFilters(state.filters),
    facets: cloneFacets(state.facets),
    results: cloneResults(state.results),
    stats: { ...state.stats },
    pageInfo: { ...state.pageInfo },
    autocomplete: [...state.autocomplete],
    telemetry: {
      lastInteractionAt: state.telemetry.lastInteractionAt,
      events: [...state.telemetry.events]
    }
  };
}

function validSurface(surface) {
  if (typeof surface !== 'string') return DEFAULT_SURFACE;
  return SURFACES.includes(surface.toUpperCase()) ? surface.toUpperCase() : DEFAULT_SURFACE;
}

function validSort(sortKey) {
  if (typeof sortKey !== 'string') {
    return DEFAULT_SORT;
  }
  switch (sortKey.toUpperCase()) {
    case 'RELEVANCE':
    case 'PRICE_ASC':
    case 'PRICE_DESC':
    case 'RATING_DESC':
    case 'NEWEST':
      return sortKey.toUpperCase();
    default:
      return DEFAULT_SORT;
  }
}

function sanitizeQuery(query) {
  if (typeof query !== 'string') return '';
  return query.trim().slice(0, 160);
}

function timestamp() {
  return Date.now();
}

function normalizeFacetOptions(options = []) {
  if (!Array.isArray(options)) return [];
  return options
    .filter((option) => option && typeof option === 'object')
    .map((option) => ({
      value: option.value ?? option.id ?? null,
      label: option.label ?? option.name ?? String(option.value ?? option.id ?? ''),
      count: typeof option.count === 'number' ? option.count : 0,
      selected: Boolean(option.selected),
      metadata: option.metadata ? { ...option.metadata } : undefined
    }));
}

function normalizeResponsePayload(payload = {}) {
  const results = Array.isArray(payload.results) ? payload.results : [];
  const normalizedResults = results.map((result) => ({
    id: result.id ?? result.slug ?? result.handle ?? `result-${Math.random().toString(36).slice(2)}`,
    surface: validSurface(result.surface ?? payload.surface ?? DEFAULT_SURFACE),
    displayName: result.displayName ?? result.name ?? 'Unknown',
    headline: result.headline ?? null,
    city: result.city ?? null,
    region: result.region ?? null,
    country: result.country ?? null,
    priceFrom: result.priceFrom ?? result.priceFromCents ?? null,
    priceTo: result.priceTo ?? result.priceToCents ?? null,
    ratingAvg: typeof result.ratingAvg === 'number' ? result.ratingAvg : null,
    ratingCount: typeof result.ratingCount === 'number' ? result.ratingCount : null,
    badges: Array.isArray(result.badges) ? [...result.badges] : [],
    tags: Array.isArray(result.tags) ? [...result.tags] : [],
    heroImage: result.heroImage ? { ...result.heroImage } : null,
    gallery: Array.isArray(result.gallery) ? result.gallery.map((item) => ({ ...item })) : [],
    safeModeBand: typeof result.safeModeBand === 'number' ? result.safeModeBand : result.safeModeBandMax ?? 0,
    safeModeOverride: Boolean(result.safeModeOverride),
    completeness: typeof result.completeness === 'number' ? Math.max(0, Math.min(100, result.completeness)) : null,
    promotion: result.promotion ?? null,
    packages: Array.isArray(result.packages) ? result.packages.map((pkg) => ({ ...pkg })) : [],
    amenities: Array.isArray(result.amenities) ? [...result.amenities] : [],
    availabilityBuckets: Array.isArray(result.availabilityBuckets)
      ? [...result.availabilityBuckets]
      : [],
    instantBook: Boolean(result.instantBook),
    verified: {
      id: Boolean(result.verified?.id ?? result.verifiedId),
      background: Boolean(result.verified?.background ?? result.verifiedBg),
      social: Boolean(result.verified?.social ?? result.verifiedSocial)
    },
    url: result.url ?? null,
    role: result.role ?? null,
    studio: result.studio ?? null,
    telemetry: result.telemetry ? { ...result.telemetry } : undefined,
    completenessSegments: result.completenessSegments
      ? { ...result.completenessSegments }
      : undefined
  }));

  const facetsPayload = payload.facets ?? {};
  const facets = {};
  for (const [facetKey, facetValue] of Object.entries(facetsPayload)) {
    if (!facetValue) continue;
    const base = {
      label: facetValue.label ?? facetKey,
      multi: facetValue.multi ?? false,
      type: facetValue.type ?? 'select',
      options: normalizeFacetOptions(facetValue.options)
    };
    facets[facetKey] = base;
  }

  const stats = {
    total: typeof payload.total === 'number' ? payload.total : payload.stats?.total ?? normalizedResults.length,
    latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : payload.stats?.latencyMs ?? null
  };

  const pageInfo = {
    cursor: payload.cursor ?? payload.pageInfo?.cursor ?? null,
    hasNext: Boolean(payload.hasNext ?? payload.pageInfo?.hasNext),
    hasPrevious: Boolean(payload.hasPrevious ?? payload.pageInfo?.hasPrevious),
    page: typeof payload.page === 'number' ? payload.page : payload.pageInfo?.page ?? 1
  };

  return {
    results: normalizedResults,
    facets,
    stats,
    pageInfo,
    surface: validSurface(payload.surface ?? DEFAULT_SURFACE)
  };
}

export function createSearchStore(initial = {}) {
  const state = {
    surface: validSurface(initial.surface ?? DEFAULT_SURFACE),
    query: sanitizeQuery(initial.query ?? ''),
    safeMode: initial.safeMode !== undefined ? Boolean(initial.safeMode) : true,
    sort: validSort(initial.sort ?? DEFAULT_SORT),
    status: STATUS_IDLE,
    error: null,
    filters: cloneFilters(initial.filters),
    facets: cloneFacets(initial.facets),
    results: cloneResults(initial.results),
    stats: {
      total: initial.stats?.total ?? 0,
      latencyMs: initial.stats?.latencyMs ?? null
    },
    pageInfo: {
      cursor: initial.pageInfo?.cursor ?? null,
      hasNext: Boolean(initial.pageInfo?.hasNext),
      hasPrevious: Boolean(initial.pageInfo?.hasPrevious),
      page: initial.pageInfo?.page ?? 1
    },
    autocomplete: Array.isArray(initial.autocomplete) ? [...initial.autocomplete] : [],
    telemetry: {
      lastInteractionAt: null,
      events: []
    }
  };

  const listeners = new Set();

  function notify() {
    const snapshot = snapshotState(state);
    for (const listener of listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  function getState() {
    return snapshotState(state);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function markInteraction(eventName, metadata) {
    state.telemetry.lastInteractionAt = timestamp();
    if (eventName) {
      state.telemetry.events.push({
        name: eventName,
        at: state.telemetry.lastInteractionAt,
        metadata: metadata ? { ...metadata } : undefined
      });
      if (state.telemetry.events.length > 50) {
        state.telemetry.events.splice(0, state.telemetry.events.length - 50);
      }
    }
  }

  function setSurface(surface) {
    const nextSurface = validSurface(surface);
    if (nextSurface === state.surface) {
      return getState();
    }
    state.surface = nextSurface;
    state.filters = {};
    state.pageInfo = { cursor: null, hasNext: false, hasPrevious: false, page: 1 };
    markInteraction('search:surface_change', { surface: nextSurface });
    return notify();
  }

  function setQuery(query) {
    const sanitized = sanitizeQuery(query);
    if (sanitized === state.query) {
      return getState();
    }
    state.query = sanitized;
    state.pageInfo = { cursor: null, hasNext: false, hasPrevious: false, page: 1 };
    markInteraction('search:query_change', { query: sanitized });
    return notify();
  }

  function setSafeMode(value) {
    const enabled = value !== undefined ? Boolean(value) : true;
    if (enabled === state.safeMode) {
      return getState();
    }
    state.safeMode = enabled;
    markInteraction('search:safe_mode_toggle', { enabled });
    return notify();
  }

  function setSort(sort) {
    const normalized = validSort(sort);
    if (normalized === state.sort) {
      return getState();
    }
    state.sort = normalized;
    markInteraction('search:sort_change', { sort: normalized });
    return notify();
  }

  function setStatus(status) {
    if (![STATUS_IDLE, STATUS_LOADING, STATUS_READY, STATUS_ERROR].includes(status)) {
      throw new Error(`invalid search status: ${status}`);
    }
    if (state.status === status) {
      return getState();
    }
    state.status = status;
    return notify();
  }

  function setError(error) {
    if (!error) {
      state.error = null;
      state.status = STATUS_READY;
      return notify();
    }
    const safeMessage =
      typeof error === 'string'
        ? error
        : error && typeof error.message === 'string'
        ? error.message
        : 'unknown_search_error';
    state.error = safeMessage.slice(0, 200);
    state.status = STATUS_ERROR;
    markInteraction('search:error', { code: state.error });
    return notify();
  }

  function setFilter(key, value) {
    if (value == null || (Array.isArray(value) && value.length === 0)) {
      delete state.filters[key];
    } else {
      state.filters[key] = Array.isArray(value)
        ? value.map((item) => (item && typeof item === 'object' ? { ...item } : item))
        : typeof value === 'object'
        ? { ...value }
        : value;
    }
    state.pageInfo = { cursor: null, hasNext: false, hasPrevious: false, page: 1 };
    markInteraction('search:filter_change', { key, value: state.filters[key] });
    return notify();
  }

  function clearFilters(keys) {
    if (!keys) {
      state.filters = {};
      markInteraction('search:filters_reset');
      return notify();
    }
    const keysToClear = Array.isArray(keys) ? keys : [keys];
    for (const key of keysToClear) {
      delete state.filters[key];
    }
    markInteraction('search:filters_partial_reset', { keys: keysToClear });
    return notify();
  }

  function setAutocomplete(suggestions) {
    state.autocomplete = Array.isArray(suggestions) ? [...suggestions] : [];
    return notify();
  }

  function applyResponse(payload, { append = false } = {}) {
    const normalized = normalizeResponsePayload(payload);
    state.facets = cloneFacets(normalized.facets);
    state.stats = { ...normalized.stats };
    state.pageInfo = { ...normalized.pageInfo };
    if (append) {
      state.results = [...state.results, ...normalized.results];
    } else {
      state.results = normalized.results;
    }
    state.status = STATUS_READY;
    state.error = null;
    markInteraction('search:results_hydrated', {
      total: state.stats.total,
      append,
      page: state.pageInfo.page
    });
    return notify();
  }

  function reset() {
    state.query = '';
    state.filters = {};
    state.results = [];
    state.autocomplete = [];
    state.stats = { total: 0, latencyMs: null };
    state.pageInfo = { cursor: null, hasNext: false, hasPrevious: false, page: 1 };
    state.error = null;
    state.status = STATUS_IDLE;
    markInteraction('search:reset');
    return notify();
  }

  return {
    subscribe,
    getState,
    setSurface,
    setQuery,
    setSafeMode,
    setSort,
    setStatus,
    setError,
    setFilter,
    clearFilters,
    setAutocomplete,
    applyResponse,
    appendResponse(payload) {
      return applyResponse(payload, { append: true });
    },
    reset
  };
}

export const SEARCH_STATUS = {
  IDLE: STATUS_IDLE,
  LOADING: STATUS_LOADING,
  READY: STATUS_READY,
  ERROR: STATUS_ERROR
};
