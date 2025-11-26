'use client';

import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';

import {
  describeFilterValue,
  listFiltersForSurface
} from '../../../tools/frontend/search/index.mjs';

type FilterType = 'boolean' | 'range' | 'multi-select' | 'date-range' | 'text';

interface FilterDescriptor {
  key: string;
  label?: string;
  type: FilterType;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

interface SearchFiltersProps {
  surface: 'PEOPLE' | 'STUDIOS';
  role?: string | null;
  filters: Record<string, unknown>;
  facets: Record<
    string,
    {
      label?: string;
      options?: Array<{ value: string; label?: string; count?: number; selected?: boolean }>;
    }
  >;
  onFilterChange: (key: string, value: unknown) => void;
  onClearFilters: (keys?: string[]) => void;
}

function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export function SearchFilters({
  surface,
  role,
  filters,
  facets,
  onFilterChange,
  onClearFilters
}: SearchFiltersProps) {
  const descriptors = useMemo<FilterDescriptor[]>(
    () => listFiltersForSurface(surface, role ?? undefined) as FilterDescriptor[],
    [surface, role]
  );
  const [expanded, setExpanded] = useState(false);

  const appliedFilters = useMemo(() => {
    const entries: Array<{ key: string; label: string; value: string }> = [];
    for (const descriptor of descriptors) {
      const currentValue = filters[descriptor.key];
      if (currentValue == null || (Array.isArray(currentValue) && currentValue.length === 0)) {
        continue;
      }
      const label = descriptor.label ?? descriptor.key;
      const valueLabel =
        describeFilterValue(descriptor.key, currentValue) ?? JSON.stringify(currentValue);
      entries.push({ key: descriptor.key, label, value: valueLabel });
    }
    return entries;
  }, [descriptors, filters]);

  const resolvedFacets = facets ?? {};

  return (
    <section className="search-filters" aria-label="Search filters">
      <header className="search-filters__header">
        <h2 className="search-filters__title">Filters</h2>
        <div className="search-filters__actions">
          <button
            type="button"
            className="search-filters__toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Hide filters' : 'Show filters'}
          </button>
          <button
            type="button"
            className="search-filters__clear"
            onClick={() => onClearFilters()}
            disabled={appliedFilters.length === 0}
          >
            Clear all
          </button>
        </div>
      </header>

      {appliedFilters.length ? (
        <ul className="search-filters__chips" aria-label="Applied filters">
          {appliedFilters.map((chip) => (
            <li key={chip.key} className="search-filters__chip">
              <span className="search-filters__chip-label">
                {chip.label}: {chip.value}
              </span>
              <button
                type="button"
                className="search-filters__chip-remove"
                aria-label={`Remove filter ${chip.label}`}
                onClick={() => onClearFilters([chip.key])}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        className={`search-filters__panel${expanded ? ' search-filters__panel--expanded' : ''}`}
      >
        {descriptors.map((descriptor) => {
          const facet = resolvedFacets[descriptor.key];
          return (
            <FilterControl
              key={descriptor.key}
              descriptor={descriptor}
              facet={facet}
              value={filters[descriptor.key]}
              onChange={(value) => onFilterChange(descriptor.key, value)}
            />
          );
        })}
      </div>
    </section>
  );
}

interface FilterControlProps {
  descriptor: FilterDescriptor;
  facet?:
    | {
        label?: string;
        options?: Array<{ value: string; label?: string; count?: number; selected?: boolean }>;
      }
    | undefined;
  value: unknown;
  onChange: (value: unknown) => void;
}

function FilterControl({ descriptor, facet, value, onChange }: FilterControlProps) {
  const label = descriptor.label ?? descriptor.key;
  const options: string[] =
    descriptor.options ?? facet?.options?.map((option) => option.value) ?? [];

  if (descriptor.type === 'boolean') {
    return (
      <div className="search-filter" role="group" aria-labelledby={`filter-${descriptor.key}`}>
        <div className="search-filter__control">
          <input
            id={`filter-${descriptor.key}`}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
          />
          <label htmlFor={`filter-${descriptor.key}`}>{label}</label>
        </div>
      </div>
    );
  }

  if (descriptor.type === 'range') {
    const rangeValue =
      value && typeof value === 'object'
        ? (value as { min?: number; max?: number })
        : { min: undefined, max: undefined };
    return (
      <fieldset className="search-filter search-filter--range">
        <legend id={`filter-${descriptor.key}`}>{label}</legend>
        <div className="search-filter__range-inputs">
          <label className="search-filter__range-label">
            Min
            <input
              type="number"
              inputMode="numeric"
              min={descriptor.min}
              max={descriptor.max}
              step={descriptor.step ?? 1}
              value={rangeValue.min ?? ''}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onChange({
                  ...rangeValue,
                  min: event.target.value ? Number(event.target.value) : undefined
                })
              }
            />
          </label>
          <label className="search-filter__range-label">
            Max
            <input
              type="number"
              inputMode="numeric"
              min={descriptor.min}
              max={descriptor.max}
              step={descriptor.step ?? 1}
              value={rangeValue.max ?? ''}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onChange({
                  ...rangeValue,
                  max: event.target.value ? Number(event.target.value) : undefined
                })
              }
            />
          </label>
        </div>
      </fieldset>
    );
  }

  if (descriptor.type === 'multi-select') {
    const selected = new Set(ensureArray(value as string[]));
    return (
      <fieldset className="search-filter search-filter--multiselect">
        <legend id={`filter-${descriptor.key}`}>{label}</legend>
        <ul className="search-filter__option-list">
          {options.map((option) => {
            const optionValue = option;
            const facetOption = facet?.options?.find((item) => item.value === optionValue);
            const optionLabel = facetOption?.label ?? optionValue;
            const count = facetOption?.count;
            return (
              <li key={optionValue} className="search-filter__option-item">
                <div className="search-filter__control">
                  <input
                    id={`filter-${descriptor.key}-${optionValue}`}
                    type="checkbox"
                    checked={selected.has(optionValue)}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const next = new Set(selected);
                      if (event.target.checked) {
                        next.add(optionValue);
                      } else {
                        next.delete(optionValue);
                      }
                      onChange(Array.from(next));
                    }}
                  />
                  <label htmlFor={`filter-${descriptor.key}-${optionValue}`}>
                    {optionLabel}
                    {typeof count === 'number' ? (
                      <span className="search-filter__option-count" aria-hidden="true">
                        {count}
                      </span>
                    ) : null}
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      </fieldset>
    );
  }

  if (descriptor.type === 'date-range') {
    const dateValue =
      value && typeof value === 'object'
        ? (value as { start?: string; end?: string })
        : { start: undefined, end: undefined };
    return (
      <fieldset className="search-filter search-filter--daterange">
        <legend id={`filter-${descriptor.key}`}>{label}</legend>
        <div className="search-filter__range-inputs">
          <label className="search-filter__range-label">
            Start
            <input
              type="date"
              value={dateValue.start ?? ''}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onChange({
                  ...dateValue,
                  start: event.target.value || undefined
                })
              }
            />
          </label>
          <label className="search-filter__range-label">
            End
            <input
              type="date"
              value={dateValue.end ?? ''}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onChange({
                  ...dateValue,
                  end: event.target.value || undefined
                })
              }
            />
          </label>
        </div>
      </fieldset>
    );
  }

  return (
    <div className="search-filter search-filter--text">
      <label htmlFor={`filter-${descriptor.key}`}>{label}</label>
      <input
        id={`filter-${descriptor.key}`}
        type="search"
        placeholder={descriptor.placeholder ?? label}
        value={(value as string) ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
    </div>
  );
}
