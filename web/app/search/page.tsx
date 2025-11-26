import type { Metadata } from 'next';

import { SearchWorkspace } from '../../components/Search';
import { createSearchDataSource } from '../../lib/search';
import {
  parseFilters,
  normalizeGraphqlSearchPayload
} from '../../../tools/frontend/search/index.mjs';

export const metadata: Metadata = {
  title: 'Search Talent & Studios | RastUp',
  description:
    'Discover verified models, photographers, creators, videographers, and studios with availability, instant book, and Safe-Mode controls.',
  alternates: {
    canonical: 'https://rastup.com/search'
  }
};

const AVAILABLE_ROLES = [
  { value: 'MODEL', label: 'Models' },
  { value: 'PHOTOGRAPHER', label: 'Photographers' },
  { value: 'VIDEOGRAPHER', label: 'Videographers' },
  { value: 'CREATOR', label: 'Creators' },
  { value: 'FANSUB', label: 'FanSub Creators' }
];

type SearchPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function coerceString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SearchPage({ searchParams = {} }: SearchPageProps) {
  const surfaceParam = coerceString(searchParams.surface);
  const queryParam = coerceString(searchParams.q);
  const roleParam = coerceString(searchParams.role);
  const safeModeParam = coerceString(searchParams.safeMode);
  const sortParam = coerceString(searchParams.sort);

  const surface = surfaceParam === 'STUDIOS' ? 'STUDIOS' : 'PEOPLE';
  const query = queryParam ?? '';
  const role = roleParam ?? null;
  const safeMode = safeModeParam === 'off' ? false : true;
  const sort = sortParam ?? 'RELEVANCE';

  const filterParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (['surface', 'q', 'role', 'safeMode', 'sort'].includes(key)) continue;
    const stringValue = coerceString(value);
    if (stringValue != null) {
      filterParams[key] = stringValue;
    }
  }

  const filters = parseFilters(filterParams) as Record<string, unknown>;
  if (role) {
    (filters as Record<string, unknown> & { role?: string }).role = role;
  }

  const dataSource = createSearchDataSource();
  const payload = await dataSource.search({
    surface,
    query,
    filters,
    sort,
    safeMode
  });

  const normalizedPayload = normalizeGraphqlSearchPayload(payload);

  return (
    <SearchWorkspace
      initialSurface={surface}
      initialRole={role}
      initialQuery={query}
      initialFilters={filters}
      initialSafeMode={safeMode}
      initialSort={sort}
      initialPayload={normalizedPayload}
      availableRoles={AVAILABLE_ROLES}
    />
  );
}
