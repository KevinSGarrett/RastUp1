// TypeScript re-exports for the ESM implementation to preserve type-checking.
// This pattern allows Node built-in tests (ESM) while providing TS contracts.

export * from './ranking.js';
export type {
  SearchDocument,
  RankingContext,
  RankingWeights,
  RankingScore
} from './types';
