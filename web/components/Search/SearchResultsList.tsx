'use client';

import { SearchResultCard } from './SearchResultCard';

type SearchResultCardProps = import('./SearchResultCard').SearchResultCardProps;

export interface SearchResultsListProps {
  results: Array<SearchResultCardProps['result']>;
  safeModeEnabled: boolean;
  loading: boolean;
  error?: string | null;
  total?: number | null;
  hasNext?: boolean;
  onSelectResult?: (resultId: string) => void;
  onLoadMore?: () => void;

  // New context props for nicer UX
  surface: 'PEOPLE' | 'STUDIOS';
  role?: string | null;
  query?: string;
  hasActiveFilters?: boolean;
  onResetFilters?: () => void;
}

export function SearchResultsList({
  results,
  safeModeEnabled,
  loading,
  error,
  total,
  hasNext,
  onSelectResult,
  onLoadMore,
  surface,
  role,
  query,
  hasActiveFilters,
  onResetFilters
}: SearchResultsListProps) {
  const totalCount = typeof total === 'number' ? total : results.length;
  const surfaceLabel = surface === 'PEOPLE' ? 'People' : 'Studios';
  const roleLabel =
    role != null && role !== ''
      ? role.charAt(0) + role.slice(1).toLowerCase()
      : null;

  const contextParts: string[] = [surfaceLabel];
  if (roleLabel) {
    contextParts.push(`Role: ${roleLabel}`);
  }
  if (hasActiveFilters) {
    contextParts.push('Filters on');
  }

  const showEmptyState = !error && !loading && results.length === 0;

  return (
    <section className="search-results" aria-live="polite">
      <header className="search-results__header">
        <div className="search-results__header-main">
          <h2 className="search-results__title">Results</h2>
          {typeof totalCount === 'number' ? (
            <p className="search-results__count" aria-live="polite">
              {totalCount} match{totalCount === 1 ? '' : 'es'}
            </p>
          ) : null}
        </div>

        <div className="search-results__header-meta">
          {contextParts.length ? (
            <p className="search-results__context">
              {contextParts.join(' • ')}
            </p>
          ) : null}
          {query ? (
            <p className="search-results__query">
              for <span className="search-results__query-value">“{query}”</span>
            </p>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="search-results__error" role="alert">
          <strong>We could not complete your search.</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {showEmptyState ? (
        <div className="search-results__empty">
          <p>No results match your current search.</p>
          {query ? (
            <p className="search-results__empty-line">
              Query: <strong>“{query}”</strong>
            </p>
          ) : null}
          {hasActiveFilters ? (
            <p className="search-results__empty-line">
              You have filters applied. Clearing them may show more results.
            </p>
          ) : null}
          {onResetFilters ? (
            <div className="search-results__empty-actions">
              <button
                type="button"
                className="search-results__clear-filters"
                onClick={onResetFilters}
              >
                Clear all filters
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="search-results__grid">
        {results.map((result) => (
          <SearchResultCard
            key={result.id}
            result={result}
            safeModeEnabled={safeModeEnabled}
            onSelect={onSelectResult}
          />
        ))}
      </div>

      <div className="search-results__footer">
        {loading ? (
          <span
            className="search-results__loading"
            role="status"
            aria-live="polite"
          >
            Loading…
          </span>
        ) : null}
        {hasNext ? (
          <button
            type="button"
            className="search-results__load-more"
            onClick={onLoadMore}
            disabled={loading}
          >
            Load more
          </button>
        ) : null}
      </div>
    </section>
  );
}
