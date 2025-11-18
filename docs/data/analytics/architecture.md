# Analytics Lakehouse Architecture

Status: Draft v0.1 (2025-11-18)  
Owner: Data Platform (AGENT-1 bootstrap)  
Scope: WBS-020 — analytics ingestion, schema validation, identity stitching, serving, and observability.

## 1. End-to-End Flow

1. **Collection**
   - Web/App SDKs post envelopes to `POST /collect` (AppSync → Lambda authorizer).
   - Backend services emit domain events to EventBridge.
   - Third parties (Stripe, SES, IDV) post into webhook ingesters.
2. **Transport**
   - EventBridge → Kinesis Firehose → S3 bucket `s3://analytics-bronze/events/dt=YYYY-MM-DD/hour=HH/`.
   - Firehose Lambda performs _schema routing_ using `event` + `v`, writing failures to `s3://analytics-quarantine/`.
3. **Bronze Gate**
   - `schema_contract_registry` (Git-backed manifest) validates JSON Schema at ingest.
   - `analytics_event_bronze` (Aurora) mirrors Firehose batches for near-real-time queries.
4. **Identity Stitch**
   - Streaming job (AWS Glue Streaming) builds identity graph keyed by `user_id`, `anon_id`, `session_id`, `device.ua_hash`, `ids.lbg_id`.
   - Identity edges stored in `identity_link` (Aurora) and `identity_graph_snapshot` (S3 Parquet).
5. **Silver Curate**
   - Glue jobs (PySpark) conform payloads, join reference tables, and enforce privacy tiers.
   - dbt on Athena materialises facts/dims with incremental partitions.
6. **Gold Serve**
   - Gold marts (Athena/Parquet) provide KPI surfaces.
   - QuickSight + Metabase pull from Gold; Ops dashboards use CTAS materialised views refreshed ≤10 min.

## 2. Event Envelope & Schema Validation

- **Envelope contract** is the canonical shape defined in TD-0066 with `meta`, `context`, and `payload`.
- **Validation pipeline**
  - SDK emits envelope with SHA256 signature of sorted payload for tamper detection.
  - Lambda fetches schema URI from manifest and validates via `fastjsonschema`.
  - Failures tagged with `schema_failure_reason` and archived; Ops alerted when failure rate >0.3% per 5 min.
  - Successful events receive `ingested_at`, `partition_key`, and `privacy_tier`.
- **Versioning**
  - Breaking changes bump `v` and require backward-compatible Silver transformation.
  - Compatibility matrix stored in `docs/data/events/compatibility_matrix.md` (TBD).

## 3. Identity Stitching Strategy

| Identifier | Source | Persistence | Notes |
|------------|--------|-------------|-------|
| `user_id` | Auth service | Primary key | Guaranteed unique when logged in. |
| `anon_id` | SDK cookie/device storage | 400 days | Rotated on privacy reset; hashed with device salt. |
| `session_id` | SDK | 24 hours | Distinguishes visits. |
| `device.ua_hash` | UA fingerprint | 90 days | Used only for fraud heuristics. |
| `ids.*` | Domain-specific | Varies | Booking (`leg_id`), messaging (`thread_id`), docs (`doc_id`). |

Identity pipeline steps:

1. Build edges (`u-usr` ↔ `a-anon`, `u-usr` ↔ `d-device`) on any event containing both identifiers.
2. Apply salted hash bucketing to avoid collisions (`sha256(identifier + secret_salt)`).
3. Nightly batch deduplicates edges and produces connected components.
4. `identity_resolution` table stores canonical `identity_id` with `confidence_score`.
5. Downstream Silver joins use `identity_id` to ensure cross-device stitching.

Privacy guardrails:

- `identity_resolution` resides in `Silver Private`; access audited.
- DSAR deletes remove component membership and propagate tombstone events.

## 4. Transformation Layers

### Bronze
- Storage: S3 NDJSON + Aurora mirror.
- Immutable; only new partitions appended.
- Metadata: `bronze_event_metadata` table stores manifest hash, schema version.

### Silver
- Materialised as Parquet in `s3://analytics-silver/<table>/dt=...`.
- dbt models add surrogate keys, fact/dimension separation.
- Automated tests:
  - Uniqueness on natural keys (e.g., `fact_booking_legs.leg_id`).
  - Referential integrity checks vs `dim_user_public`.
  - Great Expectations suites referenced in `docs/data/analytics/data_quality.md`.

### Gold
- Aggregated tables: `kpi_gmv_daily`, `kpi_conversion_funnel`, `kpi_payout_backlog`.
- Exposure: Athena views (`analytics_gold.metabase_*`), QuickSight SPICE datasets.
- Freshness monitors update `analytics_job_run` table.

## 5. Serving & Access Patterns

- **Athena**: Primary analytical SQL; require partition filters with `dt` and `country`.
- **QuickSight**: Executive, Ops, Trust, Finance, Support workspaces with row-level security tied to Lake Formation tags.
- **Metabase**: Self-serve; limited to Silver sanitized tables.
- **APIs**: Admin dashboards hit precomputed Parquet via Lambda + API Gateway.
- **Exports**: Analysts can request dataset exports; triggered Step Function uses Lake Formation delegation + KMS encryption.

## 6. Observability & Metadata

- `analytics_job_run` table tracks ETL jobs with columns (`job_name`, `scheduled_at`, `started_at`, `completed_at`, `status`, `rows_processed`, `bytes_scanned`).
- `lineage_edge` table captures source → target mapping for dbt models; exported to DataHub (future).
- CloudWatch metrics:
  - `IngestionLagSeconds`, `SchemaFailureRate`, `IdentityMatchConfidence`, `AthenaBytesScanned`.
- Alerts:
  - p95 ingestion lag > 60 s (critical).
  - Bronze→Silver freshness > 15 min (warning).
  - Schema failure rate > 0.5% (critical).
  - Athena bytes scanned > budget (warning, triggers cost runbook).

## 7. Security & Privacy Controls

- PII is never stored in events; Silver attaches hashed attributes only inside `silver_private`.
- Lake Formation governs column-level masking; analysts receive row filters by `city`.
- All access audited via CloudTrail + Lake Formation.
- `pii_mask_audit` records transformations with reason codes.
- DSAR tombstones propagate to Bronze read filters (exclusion list) and Silver/Gold purge jobs.
- Incident response documented in `runbooks.md`.

## 8. Cost & Performance Summary

| Component | Budget | Control |
|-----------|--------|---------|
| S3 Bronze | 9 TB / month | Lifecycle to Glacier after 90 days; compaction reduces small files. |
| Athena | \$3k / month | Enforce workgroup query limits, auto-terminate long scans, require partitions. |
| Glue | 20 DPUs baseline | Use job bookmarks, auto-stop on idle, share libraries. |
| QuickSight | 30 SPICE GB | Archive unused datasets, refresh cadences per dashboard. |

Details and guardrails are elaborated in `cost_controls.md`.

## 9. Open Items

- Define cross-cloud failover for ingestion (GCP/Azure) — pending architecture review.
- Complete schema compatibility matrix and publish upgrade checklist.
- Instrument DataHub ingestion for lineage graph.
- Evaluate event-level dedupe using DynamoDB for `request_id`.
