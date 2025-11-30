'use client';

import { useId } from 'react';

export interface SearchTabsProps {
  surface: 'PEOPLE' | 'STUDIOS';
  onSurfaceChange: (surface: 'PEOPLE' | 'STUDIOS') => void;
  role?: string | null;
  onRoleChange?: (role: string | null) => void;
  availableRoles?: Array<{ value: string; label: string }>;
}

export function SearchTabs({
  surface,
  onSurfaceChange,
  role,
  onRoleChange,
  availableRoles = []
}: SearchTabsProps) {
  const tabsId = useId();
  const peopleSelected = surface === 'PEOPLE';
  const studiosSelected = surface === 'STUDIOS';

  return (
    <div className="search-tabs" role="tablist" aria-label="Search surface">
      <button
        id={`${tabsId}-people`}
        role="tab"
        aria-selected={peopleSelected}
        tabIndex={peopleSelected ? 0 : -1}
        className={`search-tabs__tab${peopleSelected ? ' search-tabs__tab--active' : ''}`}
        onClick={() => onSurfaceChange('PEOPLE')}
      >
        Talent
      </button>
      <button
        id={`${tabsId}-studios`}
        role="tab"
        aria-selected={studiosSelected}
        tabIndex={studiosSelected ? 0 : -1}
        className={`search-tabs__tab${studiosSelected ? ' search-tabs__tab--active' : ''}`}
        onClick={() => onSurfaceChange('STUDIOS')}
      >
        Studios
      </button>

      {peopleSelected && availableRoles.length ? (
        <div className="search-tabs__role-select">
          <label htmlFor={`${tabsId}-role`} className="search-tabs__role-label">
            Role
          </label>
          <select
            id={`${tabsId}-role`}
            className="search-tabs__role-input"
            value={role ?? ''}
            onChange={(event) => onRoleChange?.(event.target.value || null)}
          >
            <option value="">All roles</option>
            {availableRoles.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
