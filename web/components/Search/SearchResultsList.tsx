'use client';

import { SearchResultCard } from './SearchResultCard';

type SearchResultCardProps = import('./SearchResultCard').SearchResultCardProps;

export interface SearchResultsListProps {
  results: Array<SearchResultCardProps['result']>;
  safeModeEnabled: boolean;
  loading: boolean;
  error?: string | null;
  total?: number | null;
  onSelectResult?: (resultId: string) => void;
  onLoadMore?: () => void;
  hasNext?: boolean;
}

export function SearchResultsList({
  results,
  safeModeEnabled,
  loading,
  error,
  total,
  onSelectResult,
  onLoadMore,
  hasNext
}: SearchResultsListProps) {
  return (
    <section className="search-results" aria-live="polite">
      <header className="search-results__header">
        <h2 className="search-results__title">Results</h2>
        {typeof total === 'number' ? (
          <p className="search-results__count" aria-live="polite">
            {total} match{total === 1 ? '' : 'es'}
          </p>
        ) : null}
      </header>

      {error ? (
        <div className="search-results__error" role="alert">
          <strong>We could not complete your search.</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {results.length === 0 && !loading ? (
        <p className="search-results__empty">No results match your filters. Try broadening your query.</p>
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
        {loading ? <span className="search-results__loading">Loading…</span> : null}
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
