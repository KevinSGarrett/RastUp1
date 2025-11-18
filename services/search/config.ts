import type { PromotionConfig, RankingContext, RankingWeights } from './types';

export interface SearchServiceConfig {
  version: string;
  cacheTtlSeconds: number;
  staleWhileRevalidateSeconds: number;
  cursorCacheSeconds: number;
  rateLimits: {
    search: { perIp: number; perAccount: number };
    suggest: { perIp: number; perAccount: number };
  };
  ranking: {
    weights: RankingWeights;
    newSellerFloor: RankingContext['newSellerFloor'];
    ownerDiversity: RankingContext['ownerDiversity'];
    allowSafeModeBand: number;
  };
  promotions: PromotionConfig;
  telemetry: {
    namespace: string;
    events: string[];
  };
  costControls: {
    cacheHitRateTarget: number;
    maxTypesenseLatencyMs: number;
  };
}

export const defaultSearchServiceConfig: SearchServiceConfig = {
  version: '2025-11-18',
  cacheTtlSeconds: 90,
  staleWhileRevalidateSeconds: 30,
  cursorCacheSeconds: 120,
  rateLimits: {
    search: { perIp: 60, perAccount: 120 },
    suggest: { perIp: 120, perAccount: 240 }
  },
  ranking: {
    weights: {
      text: 0.45,
      proximity: 0.2,
      reputation: 0.12,
      verification: 0.1,
      priceFit: 0.08,
      availability: 0.03,
      recency: 0.02
    },
    newSellerFloor: {
      slots: 3,
      minRatingCount: 5
    },
    ownerDiversity: {
      maxPerOwner: 2,
      window: 20
    },
    allowSafeModeBand: 1
  },
  promotions: {
    featuredSlots: 2,
    featuredMaxAboveFold: 1,
    boostFrequency: 4,
    boostStartPosition: 5,
    maxFeaturedInTopN: 2,
    invalidClickWindowSeconds: 120
  },
  telemetry: {
    namespace: 'search',
    events: [
      'search.query',
      'search.results.render',
      'search.result.click',
      'search.result.save',
      'search.error',
      'search.integrity.invalid_request',
      'promo.slot.impression',
      'promo.slot.click',
      'promo.invalid_click.flag'
    ]
  },
  costControls: {
    cacheHitRateTarget: 0.6,
    maxTypesenseLatencyMs: 450
  }
};
