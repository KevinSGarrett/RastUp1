import {
  normalizeGraphqlSearchPayload,
  normalizeAutocompletePayload
} from '../../../tools/frontend/search/index.mjs';

const DEFAULT_PAGE_SIZE = 12;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const structuredCloneFn =
  typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone.bind(globalThis)
    : undefined;

function clone(value) {
  if (structuredCloneFn) {
    return structuredCloneFn(value);
  }
  return JSON.parse(JSON.stringify(value));
}

const STUB_PEOPLE_RESULTS = Object.freeze([
  {
    id: 'srv_mdl_avery',
    surface: 'PEOPLE',
    displayName: 'Avery Harper',
    headline: 'Fashion & editorial model',
    city: 'Austin',
    region: 'TX',
    country: 'US',
    role: 'MODEL',
    heroImage: {
      url: 'https://images.rastup.stub/avery-hero.jpg',
      alt: 'Portrait of Avery',
      nsfwBand: 0
    },
    gallery: [
      {
        url: 'https://images.rastup.stub/avery-1.jpg',
        alt: 'Editorial shoot',
        nsfwBand: 0
      },
      {
        url: 'https://images.rastup.stub/avery-2.jpg',
        alt: 'Runway shot',
        nsfwBand: 0
      }
    ],
    safeModeBand: 0,
    ratingAvg: 4.9,
    ratingCount: 42,
    priceFrom: 25000,
    instantBook: true,
    verified: { id: true, background: true, social: true },
    badges: ['Verified', 'Instant Book'],
    tags: ['fashion', 'editorial', 'commercial'],
    completeness: 92,
    packages: [
      {
        packageId: 'pkg-avery-2h',
        name: '2 Hour Editorial Shoot',
        priceCents: 25000,
        includes: ['10 edited images', 'Lookbook ready']
      }
    ],
    availabilityBuckets: [
      new Date(Date.now() + ONE_DAY_MS).toISOString().slice(0, 10),
      new Date(Date.now() + ONE_DAY_MS * 3).toISOString().slice(0, 10)
    ],
    promotion: null
  },
  {
    id: 'srv_mdl_jordan',
    surface: 'PEOPLE',
    displayName: 'Jordan Lee',
    headline: 'Commercial & lifestyle model',
    city: 'Houston',
    region: 'TX',
    country: 'US',
    role: 'MODEL',
    heroImage: {
      url: 'https://images.rastup.stub/jordan-hero.jpg',
      alt: 'Jordan smiling outdoors',
      nsfwBand: 0
    },
    gallery: [
      {
        url: 'https://images.rastup.stub/jordan-1.jpg',
        alt: 'Outdoor lifestyle shoot',
        nsfwBand: 0
      }
    ],
    safeModeBand: 0,
    ratingAvg: 4.7,
    ratingCount: 18,
    priceFrom: 18000,
    instantBook: false,
    verified: { id: true, background: false, social: true },
    badges: ['Verified ID'],
    tags: ['commercial', 'lifestyle'],
    completeness: 85,
    packages: [
      {
        packageId: 'pkg-jordan-halfday',
        name: 'Half Day Campaign',
        priceCents: 45000,
        includes: ['Half day on set', 'Usage license 1 year digital']
      }
    ],
    availabilityBuckets: [
      new Date(Date.now() + ONE_DAY_MS * 2).toISOString().slice(0, 10)
    ],
    promotion: { slot: 'FEATURED', disclosure: 'Sponsored profile' }
  }
]);

const STUB_STUDIO_RESULTS = Object.freeze([
  {
    id: 'std_east_end',
    surface: 'STUDIOS',
    displayName: 'East End Loft',
    headline: 'Natural light loft in Downtown Austin',
    city: 'Austin',
    region: 'TX',
    country: 'US',
    role: null,
    heroImage: {
      url: 'https://images.rastup.stub/east-end-hero.jpg',
      alt: 'Studio loft with natural light',
      nsfwBand: 0
    },
    gallery: [
      {
        url: 'https://images.rastup.stub/east-end-1.jpg',
        alt: 'Cyclorama wall',
        nsfwBand: 0
      },
      {
        url: 'https://images.rastup.stub/east-end-2.jpg',
        alt: 'Makeup area',
        nsfwBand: 0
      }
    ],
    safeModeBand: 0,
    ratingAvg: 4.8,
    ratingCount: 41,
    priceFrom: 3500,
    instantBook: true,
    verified: { id: true, background: true, social: false },
    amenities: [
      'natural light',
      'backdrops',
      'makeup area',
      'parking'
    ],
    completeness: 94,
    availabilityBuckets: [
      new Date(Date.now() + ONE_DAY_MS).toISOString().slice(0, 10),
      new Date(Date.now() + ONE_DAY_MS * 7).toISOString().slice(0, 10)
    ],
    promotion: null
  }
]);

export const SEARCH_QUERY = `
  query Search(
    $surface: SearchSurface!,
    $query: String,
    $filters: SearchFilterInput,
    $sort: SearchSort,
    $safeMode: Boolean!,
    $pageSize: Int,
    $cursor: String
  ) {
    search(
      surface: $surface,
      query: $query,
      filters: $filters,
      sort: $sort,
      safeMode: $safeMode,
      pageSize: $pageSize,
      cursor: $cursor
    ) {
      surface
      total
      latencyMs
      cursor
      hasNext
      results {
        edges {
          node {
            id
            displayName
            headline
            role
            url
            city
            region
            country
            heroImage {
              url
              alt
              nsfwBand
            }
            gallery(limit: 6) {
              url
              alt
              nsfwBand
            }
            price {
              fromCents
              toCents
            }
            ratingAvg
            ratingCount
            instantBook
            verifications {
              id
              background
              social
            }
            badges
            tags
            amenities
            availabilityBuckets
            safeMode {
              band
              override
            }
            completenessScore
            promotion {
              slot
              disclosure
            }
          }
        }
        pageInfo {
          endCursor
          hasNextPage
          hasPreviousPage
        }
      }
      facets {
        key
        label
        type
        multi
        options {
          value
          label
          count
          selected
        }
      }
    }
  }
`;

export const SEARCH_SUGGEST_QUERY = `
  query SearchSuggest($surface: SearchSurface!, $query: String!) {
    searchSuggest(surface: $surface, query: $query) {
      suggestions {
        query
        kind
        metadata
      }
    }
  }
`;

function buildVariables({ surface, query, filters, sort, safeMode, pageSize, cursor }) {
  return {
    surface,
    query: query || null,
    filters: filters ?? null,
    sort: sort ?? 'RELEVANCE',
    safeMode: safeMode ?? true,
    pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
    cursor: cursor ?? null
  };
}

function buildStubResponse({ surface, safeMode }) {
  const source = surface === 'STUDIOS' ? STUB_STUDIO_RESULTS : STUB_PEOPLE_RESULTS;
  const filtered = safeMode ? source.filter((item) => (item.safeModeBand ?? 0) <= 1) : source;
  return {
    surface,
    total: filtered.length,
    latencyMs: 12,
    cursor: null,
    hasNext: false,
    results: filtered,
    facets: {
      city: {
        label: 'City',
        options: [
          { value: 'Austin', label: 'Austin', count: filtered.filter((item) => item.city === 'Austin').length },
          { value: 'Houston', label: 'Houston', count: filtered.filter((item) => item.city === 'Houston').length }
        ]
      },
      instantBook: {
        label: 'Instant Book',
        options: [
          { value: 'true', label: 'Instant Book', count: filtered.filter((item) => item.instantBook).length }
        ]
      }
    },
    pageInfo: {
      cursor: null,
      hasNext: false,
      hasPrevious: false,
      page: 1
    }
  };
}

export function createSearchDataSource({
  executeQuery,
  executeSuggest,
  surfaceDefault = 'PEOPLE',
  safeModeDefault = true,
  pageSize = DEFAULT_PAGE_SIZE
} = {}) {
  async function search({
    surface = surfaceDefault,
    query,
    filters,
    sort,
    safeMode = safeModeDefault,
    cursor
  } = {}) {
    if (typeof executeQuery === 'function') {
      const variables = buildVariables({
        surface,
        query,
        filters,
        sort,
        safeMode,
        pageSize,
        cursor
      });
      const response = await executeQuery({
        query: SEARCH_QUERY,
        variables
      });
      const normalized = normalizeGraphqlSearchPayload(response?.data?.search ?? response?.search ?? response);
      return normalized;
    }

    return clone(buildStubResponse({ surface, safeMode }));
  }

  async function suggest({ surface = surfaceDefault, query } = {}) {
    if (!query || !query.trim()) {
      return [];
    }
    if (typeof executeSuggest === 'function') {
      const response = await executeSuggest({
        query: SEARCH_SUGGEST_QUERY,
        variables: { surface, query }
      });
      return normalizeAutocompletePayload(response?.data?.searchSuggest ?? response?.searchSuggest ?? response);
    }
    return normalizeAutocompletePayload([
      query.trim(),
      `${query.trim()} near me`,
      { query: 'Austin, TX', kind: 'city', metadata: { city: 'Austin', region: 'TX' } }
    ]);
  }

  return {
    search,
    suggest
  };
}
