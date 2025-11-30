'use client';

import type { ChangeEvent } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition
} from 'react';

import { normalizeGraphqlSearchPayload, createSearchDataSource } from '../../lib/search';
import {
  SEARCH_STATUS,
  createSearchStore,
  defaultFilters
} from '../../../tools/frontend/search/index.mjs';
import { emitTelemetry } from '../../lib/telemetry';
import { SearchFilters } from './SearchFilters';
import { SearchResultsList } from './SearchResultsList';
import { SearchTabs } from './SearchTabs';

type SearchStore = ReturnType<typeof createSearchStore>;
type SearchState = ReturnType<SearchStore['getState']>;
type SearchPayload = ReturnType<typeof normalizeGraphqlSearchPayload>;

type SearchSuggestion = { query: string; kind: string; metadata?: unknown };

export interface SearchWorkspaceProps {
  initialSurface?: 'PEOPLE' | 'STUDIOS';
  initialRole?: string | null;
  initialQuery?: string;
  initialFilters?: Record<string, unknown>;
  initialSafeMode?: boolean;
  initialSort?: string;
  initialPayload?: SearchPayload | null;
  availableRoles?: Array<{ value: string; label: string }>;
  dataSource?: ReturnType<typeof createSearchDataSource>;
}

export function SearchWorkspace({
  initialSurface = 'PEOPLE',
  initialRole = null,
  initialQuery = '',
  initialFilters: incomingFilters,
  initialSafeMode = true,
  initialSort = 'RELEVANCE',
  initialPayload,
  availableRoles = [],
  dataSource: injectedDataSource
}: SearchWorkspaceProps) {
  const initialFilters = useMemo(
    () => ({ ...defaultFilters(), ...(incomingFilters ?? {}) }),
    [incomingFilters]
  );

  const [store] = useState<SearchStore>(() => {
    const created = createSearchStore({
      surface: initialSurface,
      query: initialQuery,
      safeMode: initialSafeMode,
      sort: initialSort,
      filters: initialFilters
    });
    if (initialPayload) {
      created.applyResponse(initialPayload);
    }
    return created;
  });

  // React-facing snapshot of store state
  const [state, setState] = useState<SearchState>(() => store.getState());

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setState(store.getState());
    });
    return unsubscribe;
  }, [store]);

  const [role, setRole] = useState<string | null>(initialRole);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [pending, startTransition] = useTransition();
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const dataSource = useMemo(
    () => injectedDataSource ?? createSearchDataSource(),
    [injectedDataSource]
  );

  // Track the last "search input" key so we don't double-fire when
  // we re-apply a response that doesn't change the inputs.
  const lastSearchKeyRef = useRef<string | null>(null);

  // Re-apply initial payload when it changes from the server.
  useEffect(() => {
    if (!initialPayload) return;
    store.applyResponse(initialPayload);
    // Reset the lastSearchKey so the next real change triggers a fetch.
    lastSearchKeyRef.current = JSON.stringify({
      surface: initialSurface,
      query: initialQuery,
      filters: initialFilters,
      sort: initialSort,
      safeMode: initialSafeMode
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayload]);

  // Keep "role" filter in sync with the dedicated dropdown.
  useEffect(() => {
    if (role) {
      store.setFilter('role', role);
      return;
    }

    const filters = store.getState().filters as Record<string, unknown> | undefined;
    if (filters && filters['role'] != null) {
      store.setFilter('role', null);
    }
  }, [role, store]);

  // Compute whether there are any active filters (for the header/empty state)
  const hasActiveFilters = useMemo(() => {
    const filterValues = state.filters as Record<string, unknown> | undefined;
    if (!filterValues) return false;
    return Object.values(filterValues).some((value) => {
      if (value == null) return false;
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (typeof value === 'object') {
        const nested = value as Record<string, unknown>;
        return Object.values(nested).some(
          (v) => v != null && v !== ''
        );
      }
      return true;
    });
  }, [state.filters]);

  // ---- PRIMARY SEARCH EFFECT ----
  //
  // Depend only on the inputs that logically trigger a search and
  // guard with an explicit "search key" so we don't loop.
  const { surface, query, filters, sort, safeMode, status } = state;

  useEffect(() => {
    const searchKey = JSON.stringify({ surface, query, filters, sort, safeMode });

    // Don't refetch if the inputs haven't changed.
    if (searchKey === lastSearchKeyRef.current) {
      return;
    }
    lastSearchKeyRef.current = searchKey;

    // If we're already loading for this key, bail.
    if (status === SEARCH_STATUS.LOADING) {
      return;
    }

    let cancelled = false;
    const filtersSnapshot = filters;

    store.setStatus(SEARCH_STATUS.LOADING);

    startTransition(() => {
      dataSource
        .search({
          surface,
          query,
          filters: filtersSnapshot,
          sort,
          safeMode
        })
        .then((payload: SearchPayload) => {
          if (cancelled) return;
          store.applyResponse(payload);
          setErrorBanner(null);
          // after a successful response, inputs still match searchKey,
          // so the effect will not re-run until the user changes something.
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const safeMessage =
            error instanceof Error
              ? error.message
              : typeof error === 'string'
              ? error
              : 'search_failed';
          store.setError(safeMessage);
          setErrorBanner(safeMessage);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [surface, query, filters, sort, safeMode, status, dataSource, startTransition, store]);

  // Fetch suggestions as the user types.
  useEffect(() => {
    if (!state.query || state.query.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      dataSource
        .suggest({ surface: state.surface, query: state.query })
        .then((payload: SearchSuggestion[]) => {
          if (!cancelled) {
            setSuggestions(payload);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [dataSource, state.query, state.surface]);

  const handleSurfaceChange = useCallback(
    (nextSurface: 'PEOPLE' | 'STUDIOS') => {
      store.setSurface(nextSurface);
      if (nextSurface === 'STUDIOS') {
        setRole(null);
      }
      emitTelemetry('search:surface_change', { surface: nextSurface });
    },
    [store]
  );

  const handleSafeModeToggle = useCallback(() => {
    const current = store.getState().safeMode;
    const next = !current;
    store.setSafeMode(next);
    emitTelemetry('search:safe_mode_toggle', { enabled: next });
  }, [store]);

  const handleSortChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      store.setSort(event.target.value);
      emitTelemetry('search:sort_change', { sort: event.target.value });
    },
    [store]
  );

  const handleQueryChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      store.setQuery(event.target.value);
      emitTelemetry('search:query_input', { query: event.target.value });
    },
    [store]
  );

  const handleSuggestionSelect = useCallback(
    (suggestion: string) => {
      store.setQuery(suggestion);
      emitTelemetry('search:suggestion_select', { query: suggestion });
    },
    [store]
  );

  const handleFilterChange = useCallback(
    (key: string, value: unknown) => {
      store.setFilter(key, value);
      emitTelemetry('search:filter_change', { key, value });
    },
    [store]
  );

  const handleClearFilters = useCallback(
    (keys?: string[]) => {
      store.clearFilters(keys);
      emitTelemetry('search:filters_cleared', { keys });
    },
    [store]
  );

  const handleLoadMore = useCallback(() => {
    const snapshot = store.getState();
    if (!snapshot.pageInfo?.hasNext || pending) return;

    const filtersSnapshot = snapshot.filters;
    const cursor = snapshot.pageInfo?.cursor;

    startTransition(() => {
      dataSource
        .search({
          surface: snapshot.surface,
          query: snapshot.query,
          filters: filtersSnapshot,
          sort: snapshot.sort,
          safeMode: snapshot.safeMode,
          cursor
        })
        .then((payload: SearchPayload) => {
          store.appendResponse(payload);
          emitTelemetry('search:load_more', {
            page: store.getState().pageInfo?.page,
            resultCount: payload.results?.length ?? 0
          });
        })
        .catch((error: unknown) => {
          const safeMessage =
            error instanceof Error
              ? error.message
              : typeof error === 'string'
              ? error
              : 'search_failed';
          store.setError(safeMessage);
          setErrorBanner(safeMessage);
        });
    });
  }, [dataSource, pending, startTransition, store]);

  const totalResults = state.stats?.total ?? 0;
  const hasNextPage = state.pageInfo?.hasNext ?? false;

  return (
    <div className="search-workspace">
      <div className="search-workspace__controls">
        <SearchTabs
          surface={state.surface}
          onSurfaceChange={handleSurfaceChange}
          role={role}
          onRoleChange={setRole}
          availableRoles={availableRoles}
        />

        <div className="search-workspace__query-row">
          <label htmlFor="search-workspace-query" className="search-workspace__query-label">
            Search
          </label>
          <div className="search-workspace__query-input">
            <input
              id="search-workspace-query"
              type="search"
              value={state.query}
              onChange={handleQueryChange}
              autoComplete="off"
              placeholder="Search by role, city, or keyword"
              aria-autocomplete="list"
              aria-controls="search-workspace-suggestions"
              aria-expanded={suggestions.length > 0}
            />
            {suggestions.length ? (
              <ul
                id="search-workspace-suggestions"
                className="search-workspace__suggestions"
                role="listbox"
              >
                {suggestions.map((suggestion) => (
                  <li key={`${suggestion.kind}-${suggestion.query}`}>
                    <button
                      type="button"
                      onClick={() => handleSuggestionSelect(suggestion.query)}
                      className="search-workspace__suggestion"
                      role="option"
                    >
                      {suggestion.query}
                      {suggestion.kind !== 'query' ? (
                        <span className="search-workspace__suggestion-kind">
                          {suggestion.kind}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="search-workspace__toggles">
            <label className="search-workspace__toggle">
              <input
                type="checkbox"
                checked={state.safeMode}
                onChange={handleSafeModeToggle}
              />
              Safe-Mode
            </label>
            <label className="search-workspace__toggle">
              Sort
              <select value={state.sort} onChange={handleSortChange}>
                <option value="RELEVANCE">Relevance</option>
                <option value="PRICE_ASC">Price (low to high)</option>
                <option value="PRICE_DESC">Price (high to low)</option>
                <option value="RATING_DESC">Rating</option>
                <option value="NEWEST">Newest</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="search-workspace__layout">
        <aside className="search-workspace__filters">
          <SearchFilters
            surface={state.surface}
            role={role}
            filters={state.filters}
            facets={state.facets}
            onFilterChange={handleFilterChange}
            onClearFilters={handleClearFilters}
          />
        </aside>

        <main className="search-workspace__results">
          {errorBanner ? (
            <div className="search-workspace__banner" role="alert">
              {errorBanner}
            </div>
          ) : null}

          <SearchResultsList
            results={state.results}
            safeModeEnabled={state.safeMode}
            loading={pending || state.status === SEARCH_STATUS.LOADING}
            error={state.status === SEARCH_STATUS.ERROR ? state.error ?? undefined : undefined}
            total={totalResults}
            hasNext={hasNextPage}
            onLoadMore={handleLoadMore}
            surface={state.surface}
            role={role}
            query={state.query}
            hasActiveFilters={hasActiveFilters}
            onResetFilters={() => handleClearFilters()}
          />
        </main>
      </div>
    </div>
  );
}
