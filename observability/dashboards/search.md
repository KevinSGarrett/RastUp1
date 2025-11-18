# Search Observability — Dashboards & Alerts

## Overview

- **Scope**: Search API (GraphQL resolvers), Typesense/OpenSearch clusters, ingestion indexer, promotions integrity.
- **Sources**: CloudWatch metrics (Lambda/AppSync), Typesense metrics API, custom telemetry events (`search.*`, `promo.*`, `index.*`), RDS for outbox backlog, Dynamo cache hit logs.
- **Audience**: Product Ops, Search Engineering, Trust & Safety, Finance (promotions spend).

## Core Dashboards

### 1. Search API Health (AppSync)

- p50 / p95 / p99 latency (cached vs uncached split)
- Request rate (overall + by surface `PEOPLE` / `STUDIOS`)
- Error rate by `SearchError.code`
- Safe-mode override attempts vs approvals
- Rate-limit rejections (per IP / per account)
- Cursor cache hits vs misses

### 2. Typesense Index Health

- Ingestion lag (time between `search.outbox.created_at` and `processed_at`)
- Document counts vs Aurora counts per surface/city
- Failed index operations (upsert/delete) by error class
- Typesense node CPU/RAM, requests per second, 429s
- Synonym changes + audit trail

### 3. Ranking & Fairness

- Diversity metrics: max per owner in top 20, new-seller presence, organic vs promoted share
- Boost/featured density caps compliance
- Price-fit alignment (avg |priceFromCents - budget|)
- Safe-mode results ratio (public vs verified)
- Policy penalty hits (docs suppressed due to dispute/cancel thresholds)

### 4. Promotions Integrity

- Paid slot impressions / clicks / CTR vs organic baseline
- Invalid-click detection rate, refunds issued
- QS distribution (min/max/median) per city×role
- Auto-coaching triggers & responses
- Daily spend vs budget cap alerts

### 5. Suggest & Autocomplete

- Suggest latency (p95)
- Suggest hit rate (results >0)
- Zero-result rescues via help articles
- Typo correction frequency

## Alerts

| Trigger | Condition | Channel | Action |
| --- | --- | --- | --- |
| `search_latency_p95_breach` | p95 latency \> 450 ms for 5 min | PagerDuty P1 | Auto scale cache/Ttypesense, fall back to OpenSearch |
| `search_error_rate` | 5xx or error code rate \>0.5% | PagerDuty P1 | Inspect correlation IDs, rollback recent deploy |
| `index_backlog_high` | Outbox backlog \> 500 events for 10 min | Slack #search-ops | Trigger catch-up job, inspect DLQ |
| `promotion_density_violation` | Featured slots \> cap or organic share \< 80% | Slack #growth-integrity | Investigate promotions config & QS distribution |
| `invalid_click_spike` | Invalid click ratio \> 8% rolling 30 min | Slack #growth-integrity | Verify IP/device heuristics, pause promotions if needed |
| `typesense_node_pressure` | CPU \> 80% or memory \> 75% for 5 min | PagerDuty P2 | Scale node / enable replica |
| `cache_hit_rate_low` | Cache hit rate \< 60% for 1h | Slack #search-backend | Evaluate query normalization, hot keys |

## Telemetry Events

- `search.query` `{surface, role, filtersHash, latencyMs, cached, safeMode, correlationId}`
- `search.results.render` `{surface, count, promotionsCount, cacheKey}`
- `search.result.click` `{documentId, slot, organic, position, correlationId}`
- `search.result.save` `{documentId, userId, correlationId}`
- `search.error` `{code, hint, correlationId}`
- `search.integrity.invalid_request` `{reason, userId, payloadHash}`
- `promo.slot.impression` `{documentId, slot, position, qs, city, role}`
- `promo.slot.click` `{documentId, slot, position, qs, orderScore}`
- `promo.invalid_click.flag` `{documentId, reason, dedupKeys}`
- `index.upsert|delete|error` `{entity, durationMs, errorClass?, retries}`

All events must carry `anon_id`, `user_id?`, `session_id`, and `correlation_id`.

## Derived Metrics

- **Cache Hit Rate** = cached-success / total search queries (target ≥ 60%)
- **Index Staleness** = avg(now - updatedAtEpoch) for top-k hot docs (alert if \> 5 min)
- **Diversity Index** = unique owners in top N / N
- **Budget Fit Score** = avg(|priceFromCents - budget| / budget)
- **QS Drift** = weekly delta of QS mean & standard deviation; highlight outliers.

## Data Quality Checks

- Outbox processed count matches index writes (±1%) daily.
- Safe-mode filter coverage: 100% of public queries include `safeModeBandMax`.
- Cursor checksums failures \< 0.1% (monitor decode errors).
- Synonym/rule edits require two-person approval and log to audit trail.

## Operational Runbooks (links)

- [`ops/runbooks/search-index.md`](../../ops/runbooks/search-index.md)
- `ops/runbooks/promotions-integrity.md` (future)
- `ops/runbooks/typesense-outage.md` (future)

## Cost Controls

- Monitor Typesense request volume vs allowance.
- Cache footprint w/ Dynamo/Redis size (alert if TTL misses cause >40% engine calls).
- Promotion spend vs budget; auto-coaching reduces spend when ROAS \< targets.
