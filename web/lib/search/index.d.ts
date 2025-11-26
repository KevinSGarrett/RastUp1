// web/lib/search/index.d.ts

// Main factory the UI uses.
export function createSearchDataSource(...args: any[]): any;

// Normalizer used in SearchWorkspace – we’ll import this there.
export function normalizeGraphqlSearchPayload(input: any): any;
