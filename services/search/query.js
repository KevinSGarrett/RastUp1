import crypto from 'node:crypto';

const DEFAULT_OPTIONS = {
  allowSafeModeOverride: false,
  maxFacetParams: 12
};

const ROLE_FILTER_KEYS = {
  MODEL: ['model'],
  PHOTOGRAPHER: ['photographer'],
  VIDEOGRAPHER: ['videographer'],
  CREATOR: ['creator'],
  FANSUB: ['creator']
};

function stableStringify(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeCity(city) {
  return city.trim();
}

function buildBudgetFilter(minCents, maxCents) {
  const clauses = [];
  if (Number.isInteger(minCents)) {
    clauses.push(`priceFromCents:>=${minCents}`);
  }
  if (Number.isInteger(maxCents)) {
    clauses.push(`priceFromCents:<=${maxCents}`);
  }
  return clauses;
}

function normalizeRoleFilters(role, input, errors) {
  const allowedKeys = new Set(ROLE_FILTER_KEYS[role] ?? []);
  const roleFilterPayload = {};
  if (!role) {
    return roleFilterPayload;
  }
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      if (input[key] != null) {
        errors.push(`SEARCH_ROLE_FILTER_CONFLICT:${key}`);
      }
      continue;
    }
    roleFilterPayload[key] = input[key];
  }
  return roleFilterPayload;
}

/**
 * Normalize the incoming search input into canonical filter expressions.
 * @param {Record<string, any>} input
 * @param {{allowSafeModeOverride?: boolean; maxFacetParams?: number; cityGate?: Set<string>; safeModeFloor?: number}} options
 */
export function normalizeSearchInput(input, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors = [];

  if (!input || !input.city) {
    errors.push('SEARCH_INVALID_LOCATION');
    return {
      filters: {},
      filterExpression: '',
      facetFilters: [],
      safeModeBandMax: opts.safeModeFloor ?? 1,
      errors
    };
  }

  const city = normalizeCity(input.city);
  if (opts.cityGate && opts.cityGate.size > 0 && !opts.cityGate.has(city)) {
    errors.push('SEARCH_CITY_GATED');
  }

  const role = input.role ?? null;
  const filterParts = [`city:="${city}"`];
  const facetFilters = [];
  const filters = {
    surface: input.surface,
    city
  };

  if (role) {
    filters.role = role;
    filterParts.push(`role:="${role}"`);
  }

  if (input.verifiedOnly) {
    filterParts.push('verification_id:=true');
    filters.verifiedOnly = true;
  }
  if (input.instantBookOnly) {
    filterParts.push('instantBook:=true');
    filters.instantBookOnly = true;
  }
  if (input.ratingMin) {
    filterParts.push(`ratingAvg:>=${Number(input.ratingMin).toFixed(1)}`);
    filters.ratingMin = Number(input.ratingMin);
  }

  const budgetClauses = buildBudgetFilter(
    Number.isFinite(input.budgetMinCents) ? Number(input.budgetMinCents) : null,
    Number.isFinite(input.budgetMaxCents) ? Number(input.budgetMaxCents) : null
  );
  if (budgetClauses.length > 0) {
    filterParts.push(...budgetClauses);
    filters.budget = {
      min: Number.isFinite(input.budgetMinCents) ? Number(input.budgetMinCents) : undefined,
      max: Number.isFinite(input.budgetMaxCents) ? Number(input.budgetMaxCents) : undefined
    };
  }

  if (input.date) {
    filterParts.push(`availabilityBuckets:="${input.date}"`);
    filters.date = input.date;
  } else if (input.dateRange?.start && input.dateRange?.end) {
    facetFilters.push(`availabilityBuckets:[${input.dateRange.start}..${input.dateRange.end}]`);
    filters.dateRange = { ...input.dateRange };
  }

  const safeModeRequested = input.safeMode !== false;
  const safeModeFloor = opts.safeModeFloor ?? 1;
  let safeModeBandMax = safeModeRequested ? safeModeFloor : 2;
  if (!safeModeRequested && !opts.allowSafeModeOverride) {
    errors.push('SEARCH_UNDERAGE_SAFEMODE');
    safeModeBandMax = safeModeFloor;
  }
  filterParts.push(`safeModeBandMax:<=${safeModeBandMax}`);
  filters.safeModeBandMax = safeModeBandMax;

  const roleFilterPayload = normalizeRoleFilters(role, input, errors);
  if (Object.keys(roleFilterPayload).length > 0) {
    filters.roleFilters = roleFilterPayload;
  }

  const facetParamCount = facetFilters.length;
  if (facetParamCount > opts.maxFacetParams) {
    errors.push('SEARCH_TOO_MANY_PARAMS');
  }

  return {
    filters,
    filterExpression: filterParts.join(' && '),
    facetFilters,
    safeModeBandMax,
    errors
  };
}

/**
 * Hashes normalized filters into a deterministic cache key.
 * @param {import('./types').CacheKeyComponents} components
 */
export function buildCacheKey(components) {
  const serialized = [
    components.surface,
    components.city,
    components.role ?? '',
    components.safeMode ? '1' : '0',
    components.normalizedFilters,
    components.personalizationKey ?? '',
    components.version
  ].join('|');
  const digest = crypto.createHash('sha256').update(serialized).digest('hex');
  return `search:${components.surface}:${digest}`;
}

export function serializeFiltersForCache(filters) {
  return stableStringify(filters);
}

/**
 * Validates whether a safe-mode override can be honoured based on role and auth context.
 * @param {{surface: string; role?: string; safeMode: boolean; userIsVerifiedAdult?: boolean}} ctx
 */
export function canOverrideSafeMode(ctx) {
  if (ctx.safeMode) {
    return true;
  }
  if (ctx.surface !== 'PEOPLE') {
    return true;
  }
  if (!ctx.userIsVerifiedAdult) {
    return false;
  }
  if (ctx.role === 'FANSUB') {
    return ctx.userIsVerifiedAdult;
  }
  return true;
}
