const DEFAULT_FILTER_STATE = Object.freeze({
  onlyUnread: false,
  includeInquiries: true,
  includeProjects: true,
  mutedMode: 'all',
  safeModeOnly: false
});

const DEFAULT_QUERY_KEYS = Object.freeze({
  thread: 'thread',
  search: 'search',
  unread: 'unread',
  kinds: 'kinds',
  muted: 'muted',
  safe: 'safe'
});

const BOOLEAN_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'enable', 'enabled']);

function coerceUrlSearchParams(input) {
  if (!input) {
    return new URLSearchParams();
  }
  if (input instanceof URLSearchParams) {
    return new URLSearchParams(input.toString());
  }
  if (typeof input === 'string') {
    return new URLSearchParams(input);
  }
  if (typeof input === 'object' && typeof input[Symbol.iterator] === 'function') {
    return new URLSearchParams(input);
  }
  throw new TypeError('Unsupported search params input');
}

function normalizeFilterState(input = {}) {
  return {
    onlyUnread: Boolean(input.onlyUnread),
    includeInquiries: input.includeInquiries !== undefined ? Boolean(input.includeInquiries) : true,
    includeProjects: input.includeProjects !== undefined ? Boolean(input.includeProjects) : true,
    mutedMode: input.mutedMode === 'muted' || input.mutedMode === 'hidden' ? input.mutedMode : 'all',
    safeModeOnly: Boolean(input.safeModeOnly)
  };
}

function parseKinds(params, key) {
  const values = params.getAll(key);
  if (!values.length) {
    return {
      includeInquiries: true,
      includeProjects: true
    };
  }
  const normalized = new Set();
  for (const entry of values) {
    if (typeof entry !== 'string') continue;
    for (const token of entry.split(',')) {
      const trimmed = token.trim().toUpperCase();
      if (trimmed) {
        normalized.add(trimmed);
      }
    }
  }
  if (!normalized.size) {
    return {
      includeInquiries: true,
      includeProjects: true
    };
  }
  const includeInquiries = normalized.has('INQUIRY');
  const includeProjects = normalized.has('PROJECT');
  if (!includeInquiries && !includeProjects) {
    return {
      includeInquiries: true,
      includeProjects: true
    };
  }
  return { includeInquiries, includeProjects };
}

function parseMuted(params, key) {
  const value = params.get(key);
  if (value === 'muted' || value === 'hidden') {
    return value;
  }
  return 'all';
}

function parseBoolean(params, key) {
  const value = params.get(key);
  if (typeof value !== 'string') {
    return false;
  }
  return BOOLEAN_TRUE_VALUES.has(value.toLowerCase());
}

function trimString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function parseMessagingQueryState(searchParams, options = {}) {
  const params = coerceUrlSearchParams(searchParams);
  const keys = { ...DEFAULT_QUERY_KEYS, ...(options.keys ?? {}) };

  const kinds = parseKinds(params, keys.kinds);
  const filters = {
    onlyUnread: parseBoolean(params, keys.unread),
    includeInquiries: kinds.includeInquiries,
    includeProjects: kinds.includeProjects,
    mutedMode: parseMuted(params, keys.muted),
    safeModeOnly: parseBoolean(params, keys.safe)
  };

  // Ensure at least one kind selected
  if (!filters.includeInquiries && !filters.includeProjects) {
    filters.includeInquiries = true;
    filters.includeProjects = true;
  }

  const threadId = trimString(params.get(keys.thread)) || null;
  const searchTerm = trimString(params.get(keys.search));

  return {
    filters,
    searchTerm,
    threadId
  };
}

function encodeKinds(filters) {
  const kinds = [];
  if (filters.includeInquiries) {
    kinds.push('INQUIRY');
  }
  if (filters.includeProjects) {
    kinds.push('PROJECT');
  }
  if (kinds.length === 0 || kinds.length === 2) {
    return null;
  }
  return kinds.join(',');
}

function applyParam(params, key, value) {
  if (!key) return;
  if (value === null || value === undefined || value === '') {
    params.delete(key);
    return;
  }
  params.set(key, value);
}

export function applyMessagingStateToSearchParams(searchParams, state, options = {}) {
  const params = coerceUrlSearchParams(searchParams);
  const keys = { ...DEFAULT_QUERY_KEYS, ...(options.keys ?? {}) };
  const filters = normalizeFilterState(state?.filters ?? {});
  const searchTerm = trimString(state?.searchTerm ?? '');
  const threadId = trimString(state?.threadId ?? '');

  if (filters.onlyUnread) {
    params.set(keys.unread, '1');
  } else {
    params.delete(keys.unread);
  }

  if (filters.safeModeOnly) {
    params.set(keys.safe, '1');
  } else {
    params.delete(keys.safe);
  }

  const mutedValue = filters.mutedMode === 'muted' || filters.mutedMode === 'hidden' ? filters.mutedMode : null;
  applyParam(params, keys.muted, mutedValue);

  const kindsValue = encodeKinds(filters);
  applyParam(params, keys.kinds, kindsValue);

  applyParam(params, keys.search, searchTerm);
  applyParam(params, keys.thread, threadId);

  return params;
}

export function isFilterStateEqual(a, b) {
  const left = normalizeFilterState(a);
  const right = normalizeFilterState(b);
  return (
    left.onlyUnread === right.onlyUnread &&
    left.includeInquiries === right.includeInquiries &&
    left.includeProjects === right.includeProjects &&
    left.mutedMode === right.mutedMode &&
    left.safeModeOnly === right.safeModeOnly
  );
}

export { DEFAULT_FILTER_STATE, DEFAULT_QUERY_KEYS };
