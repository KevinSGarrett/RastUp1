/**
 * Shared type contracts for the search service.
 * These definitions are consumed by both the indexer (ingestion pipeline)
 * and the query layer (GraphQL resolvers).
 */

export type SearchSurface = 'PEOPLE' | 'STUDIOS' | 'WORK' | 'HELP';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface SearchDocument {
  id: string;
  surface: SearchSurface;
  ownerId: string;
  city: string;
  region?: string;
  country: string;
  geo?: GeoPoint;
  role?: string;
  safeModeBandMax: number;
  ratingAvg?: number;
  ratingCount?: number;
  priceFromCents?: number;
  priceToCents?: number;
  priceBucket?: string;
  availabilityBuckets?: string[];
  availabilityScore?: number;
  instantBook?: boolean;
  verifiedId?: boolean;
  verifiedBg?: boolean;
  verifiedSocial?: boolean;
  boosts?: Record<string, number>;
  policySignals?: {
    disputeRate30d?: number;
    cancelRate90d?: number;
    lateDeliveryRate90d?: number;
  };
  promotionSlot?: 'FEATURED' | 'BOOST' | null;
  promotionPriority?: number;
  createdAtEpoch: number;
  updatedAtEpoch: number;
  textVector?: string;
  handle?: string;
  slug?: string;
  ownerGroupId?: string;
  newSellerScore?: number;
}

export interface RankingWeights {
  text: number;
  proximity: number;
  reputation: number;
  verification: number;
  priceFit: number;
  availability: number;
  recency: number;
}

export interface RankingContext {
  weights: RankingWeights;
  queryBudgetCents?: number;
  geoPreference?: {
    origin: GeoPoint;
    radiusKm: number;
  };
  date?: string;
  newSellerFloor: {
    slots: number;
    minRatingCount: number;
  };
  ownerDiversity: {
    maxPerOwner: number;
    window: number;
  };
  allowSafeModeBand: number;
  nowEpoch: number;
}

export interface RankingScore {
  baseScore: number;
  modifiers: {
    textMatch: number;
    proximity: number;
    reputation: number;
    verification: number;
    priceFit: number;
    availability: number;
    recency: number;
    fairnessPenalty: number;
    policyPenalty: number;
  };
}

export interface PromotionConfig {
  featuredSlots: number;
  featuredMaxAboveFold: number;
  boostFrequency: number;
  boostStartPosition: number;
  maxFeaturedInTopN: number;
  invalidClickWindowSeconds: number;
}

export interface PromotionCandidate {
  id: string;
  slot: 'FEATURED' | 'BOOST';
  orderScore: number;
  document: SearchDocument;
}

export interface PromotionAllocationResult {
  ordered: string[];
  invalidClickFiltered: string[];
  densityViolations: string[];
}

export interface CursorToken {
  page: number;
  pageSize: number;
  lastScore?: number;
  personalizationKey?: string;
  checksum: string;
}

export interface CacheKeyComponents {
  surface: SearchSurface;
  city: string;
  role?: string;
  safeMode: boolean;
  normalizedFilters: string;
  personalizationKey?: string;
  version: string;
}

export interface QueryNormalizationResult {
  city: string;
  region?: string;
  country?: string;
  filters: Record<string, unknown>;
  filterExpression: string;
  facetFilters: string[];
  safeModeBandMax: number;
  errors: string[];
}

export interface InvalidClickEvent {
  documentId: string;
  userId?: string;
  sessionId?: string;
  ipBlock?: string;
  occurredAt: number;
}
