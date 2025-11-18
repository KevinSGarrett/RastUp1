# WBS-003 Search & Indexing — Implementation Plan

## Context Snapshot

- WBS IDs: `WBS-003` (depends on `WBS-002`)
- Blueprint refs: `TD-0001`, `TD-0003`, `TD-0004`, `TD-0005`, `TD-0006`, `TD-0007`, `TD-0008`, `TD-0236`–`TD-0249`
- Role: AGENT-2 — Backend & Services
- Scope paths (initial): `ops/typesense/**`, `db/migrations/025_search_outbox.sql`, `api/schema/search.graphql`, `services/search/**`, `docs/data/search/**`, `tests/search/**`, `docs/PROGRESS.md`, `docs/runs/**`
- Assumptions: Aurora core schema from `WBS-002` is authoritative; no runtime infrastructure exists yet; Node/TypeScript dependencies must be vendor-free (plain ESM + stdlib).

## Plan vs Done vs Pending (pre-build)

- **Planned**
  - Author Typesense/OpenSearch collection definitions with safe-mode fields and promotion facets.
  - Produce search ingestion pipeline artifacts (outbox DDL, indexer worker) and query layer with ranking, fairness, promotions, caching, and rate limits.
  - Define GraphQL API contracts, error model, and cursor pagination spec.
  - Implement unit tests for ranking fairness, promotion density caps, safe-mode filtering, and caching key normalization.
  - Document telemetry, cost controls, and operational runbooks.
- **Done**
  - Acquired lock (`ops/locks/AGENT-2.lock`), reviewed blueprint chunks, analysed prior WBS-002 run report and repository state, created this plan document.
- **Pending**
  - Everything else from the planned list, including code artifacts, tests, telemetry docs, CI integration, and attach pack.

## Architecture & Implementation Approach

1. **Collections & Schemas**
   - Emit `ops/typesense/collections.json` covering `people_v1`, `studios_v1`, `work_v1`, and `help_v1` with analyzers, facets, safe-mode gating, and promotion metadata.
   - Include synonym configuration, score overrides, and city/role shard guidance.

2. **Ingestion Pipeline**
   - Provide `db/migrations/025_search_outbox.sql` for the `search.outbox` table and supporting indexes.
   - Author `services/search/indexer.ts` implementing a polling Lambda-compatible worker with retry, DLQ, Typesense/OpenSearch adapters, and telemetry hooks.
   - Supply `services/search/types.ts` shared contracts and `services/search/normalizer.ts` for payload shaping and availability scoring.

3. **Query Layer & Ranking**
   - Deliver `services/search/query.ts` orchestrating request normalization, caching (SWR), rate limiting, fairness filters, promotions blending, and fallback search strategy.
   - Implement modular ranking weights (`services/search/ranking.ts`) and promotion density guardrails.
   - Outline admin-config pluggability (`services/search/config.ts`) for city gates, safe-mode policies, and feature flags.

4. **GraphQL API**
   - Define `api/schema/search.graphql` with search, suggest, saved search mutations, opaque cursors, error codes, and role gating directives.
   - Provide resolver scaffolding descriptions and correlation-id propagation contract.

5. **Admin & Telemetry Docs**
   - Capture operational procedures in `ops/runbooks/search-index.md`.
   - Document dashboards and KPIs in `observability/dashboards/search.md`.

## Test Plan (pre-coding)

| Test ID | Purpose | Method | Tooling |
| --- | --- | --- | --- |
| T1 | Ranking fairness (diversity cap & new seller floor) | Node ESM unit test driving ranking module with synthetic docs | `node --test tests/search/ranking.test.mjs` |
| T2 | Safe-mode & filter enforcement | Unit test ensuring query builder appends required filters and rejects invalid combos | `node --test tests/search/query_filters.test.mjs` |
| T3 | Pagination & cursor stability | Unit test verifying cursor serialization/deserialization and cache-key isolation | `node --test tests/search/pagination.test.mjs` |
| T4 | Promotions density caps & invalid-click dedupe | Unit test for promotion slot allocator | `node --test tests/search/promotions.test.mjs` |
| T5 | Config manifest validation | Python smoke test ensuring Typesense collection JSON validates against schema | `python -m tests.search.test_collections_json` |

**Notes**

- Tests rely solely on Node built-in `assert` / `node:test` and Python stdlib to avoid external dependencies.
- Performance/SLO checks recorded via fixtures rather than live Typesense calls; follow-up WBS should integrate real benchmarks.

## Outstanding Questions / Assumptions

- Typesense credentials and environment variables will be provided by deployment orchestration; stubs will read from well-defined config keys.
- OpenSearch fallback uses REST-compatible adapter but will require AWS SigV4 signing in production (not implemented in this run).
- `make ci` currently fails (no Makefile); will re-run post-changes and document outcome as per instructions.

