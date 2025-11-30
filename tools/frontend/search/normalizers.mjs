/**
 * Normalizes a GraphQL search payload into the store-friendly shape.
 * @param {object} payload
 * @returns {{ surface: string; results: Array<object>; facets: object; stats: object; pageInfo: object }}
 */
export function normalizeGraphqlSearchPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return {
      surface: 'PEOPLE',
      results: [],
      facets: {},
      stats: { total: 0, latencyMs: null },
      pageInfo: { cursor: null, hasNext: false, hasPrevious: false, page: 1 }
    };
  }

  const surface = payload.surface ?? payload.context?.surface ?? 'PEOPLE';
  const edges = Array.isArray(payload.results?.edges)
    ? payload.results.edges
    : Array.isArray(payload.results)
    ? payload.results.map((node) => ({ node }))
    : [];

  const items = edges
    .map((edge) => edge?.node)
    .filter(Boolean)
    .map((node) => ({
      id: node.id ?? node.serviceProfileId ?? node.slug ?? node.handle ?? null,
      surface,
      displayName: node.displayName ?? node.name ?? node.owner?.displayName ?? 'Unknown',
      headline: node.headline ?? node.tagline ?? null,
      city: node.location?.city ?? node.city ?? null,
      region: node.location?.region ?? node.region ?? null,
      country: node.location?.country ?? node.country ?? null,
      role: node.role ?? node.roleType ?? null,
      heroImage: node.heroImage ?? node.media?.[0] ?? null,
      gallery: Array.isArray(node.media) ? node.media : [],
      safeModeBand: node.safeMode?.band ?? node.safeModeBandMax ?? 0,
      safeModeOverride: node.safeMode?.override ?? false,
      ratingAvg: node.reviewStats?.ratingAvg ?? node.ratingAvg ?? null,
      ratingCount: node.reviewStats?.ratingCount ?? node.ratingCount ?? null,
      priceFrom: node.price?.fromCents ?? node.priceFromCents ?? null,
      priceTo: node.price?.toCents ?? node.priceToCents ?? null,
      instantBook: Boolean(node.instantBook ?? node.flags?.instantBook),
      verified: {
        id: Boolean(node.verifications?.id ?? node.verified?.id ?? node.verifiedId),
        background: Boolean(
          node.verifications?.background ?? node.verified?.background ?? node.verifiedBg
        ),
        social: Boolean(node.verifications?.social ?? node.verified?.social ?? node.verifiedSocial)
      },
      badges: Array.isArray(node.badges) ? node.badges : [],
      tags: Array.isArray(node.tags) ? node.tags : [],
      amenities: Array.isArray(node.amenities) ? node.amenities : [],
      packages: Array.isArray(node.packages) ? node.packages : [],
      availabilityBuckets: Array.isArray(node.availabilityBuckets)
        ? node.availabilityBuckets
        : [],
      completeness: node.completenessScore ?? node.completeness ?? null,
      promotion: node.promotion ?? null,
      url: node.url ?? node.webUrl ?? null
    }));

  const facets = {};
  const facetMap = payload.facets ?? payload.availableFacets ?? {};
  for (const [facetKey, facetValue] of Object.entries(facetMap)) {
    if (!facetValue) continue;
    facets[facetKey] = {
      label: facetValue.label ?? facetKey,
      type: facetValue.type ?? 'select',
      multi: facetValue.multi ?? false,
      options: Array.isArray(facetValue.options)
        ? facetValue.options.map((option) => ({
            value: option.value ?? option.id,
            label: option.label ?? option.name ?? String(option.value ?? option.id ?? ''),
            count: option.count ?? option.hits ?? 0,
            selected: Boolean(option.selected)
          }))
        : []
    };
  }

  const stats = {
    total: payload.total ?? payload.stats?.total ?? payload.results?.totalCount ?? items.length,
    latencyMs: payload.latencyMs ?? payload.stats?.latencyMs ?? null
  };

  const pageInfo = {
    cursor: payload.cursor ?? payload.pageInfo?.cursor ?? payload.results?.pageInfo?.endCursor ?? null,
    hasNext:
      payload.hasNext ??
      payload.pageInfo?.hasNext ??
      payload.results?.pageInfo?.hasNextPage ??
      false,
    hasPrevious:
      payload.hasPrevious ??
      payload.pageInfo?.hasPrevious ??
      payload.results?.pageInfo?.hasPreviousPage ??
      false,
    page: payload.page ?? payload.pageInfo?.page ?? 1
  };

  return {
    surface,
    results: items,
    facets,
    stats,
    pageInfo
  };
}

export function normalizeAutocompletePayload(payload = {}) {
  const suggestions = payload.suggestions ?? payload.items ?? payload ?? [];
  if (!Array.isArray(suggestions)) {
    return [];
  }
  return suggestions
    .map((item) => {
      if (typeof item === 'string') {
        return { query: item, kind: 'query' };
      }
      if (!item) return null;
      return {
        query: item.query ?? item.label ?? item.value ?? '',
        kind: item.kind ?? item.type ?? 'query',
        metadata: item.metadata ? { ...item.metadata } : undefined
      };
    })
    .filter((item) => item && item.query);
}
