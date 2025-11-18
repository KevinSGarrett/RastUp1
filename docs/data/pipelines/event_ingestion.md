# Event Ingestion Pipeline (Bronze → Silver → Gold)

References: TD-0000 §1.1.S, TD-0003 §1.2.J, TD-0018 §1.3.Q, TD-0042 §1.5.B, TD-0056 §1.7.D.

## Overview

| Layer | Storage | Purpose | Quality Gates | Privacy Actions |
|-------|---------|---------|---------------|-----------------|
| Bronze | `analytics_event_bronze` (Aurora) + raw S3 parquet | Immutable append-only log of all inbound events (SDK, webhooks). | JSON Schema validation, checksum match against `schema_contract_registry`, poison-pill quarantine queue. | Hash direct identifiers, persist `privacy_tier`, record `pii_mask_strategy`. |
| Silver | `analytics_event_silver` views + curated S3 delta tables | Conforms payloads into canonical shape, enriches with user/profile references and identity graph joins. | Referential integrity check vs `app_user`, `identity_resolution`, dedupe on `request_id`. | Replace hashed identifiers with surrogate keys, drop restricted fields for lower tiers. |
| Gold | `analytics_event_gold_daily` + metrics lakehouse | Business-consumable KPIs with freshness SLAs. | Metric-level anomaly detection (3σ), completeness watchdog comparing Bronze counts, CUPED readiness for experiments. | Enforce `retention_class` windows, mask rare-dimension buckets (<5 events). |

## Data Flow

1. **Ingest**: Events land via Kinesis → Firehose into S3 partitioned by `event`/`occurred_at`. Lambda writes to Aurora Bronze.
2. **Schema Gate**: `schema_contract_ci_gate` records validation outcome; failures raise PagerDuty + S3 quarantine.
3. **Identity Stitch**: Glue Streaming job consumes Bronze change stream, updating `identity_link` and `identity_resolution` tables (see `analytics/architecture.md` §3).
4. **Dedup & Enrich**: Silver ingestion jobs join dimension tables (SCD2) and identity graph; enforce canonical keys.
5. **Privacy Tiering**: `pii_mask_strategy` drives hashed or tokenized transformations before Silver write; DSAR tombstones filter partitions.
6. **Metrics Build**: dbt (or Dagster) jobs compute Gold metrics (daily, hourly) and update `freshness_status`; experiments pipeline produces CUPED-adjusted tables.
7. **Lineage Capture**: Each transformation logs to `lineage_edge` via orchestrator hook for observability and DataHub export.

## Quality & Monitoring

- Data quality assertions stored in `docs/data/analytics/data_quality.md` (Great Expectations suites) and executed in CI + nightly runs.
- Freshness SLA: Bronze < 5 minutes lag, Silver < 15 minutes, Gold daily cut by 07:00 local timezone.
- Identity confidence monitored via `identity_resolution.confidence_score` percentiles; alerts when <0.85 median for new edges.
- Alerting: CloudWatch metrics for invalid events/sec, schema drift, privacy violations (auto rollback when >0.5% flagged), DSAR backlog > 24h.
- Replay tooling: `tools/replay_events.py` (future) reprocesses Bronze IDs after schema fixes; requires recomputing identity graph and Gold metrics.

## Privacy & Compliance

- PII inventory stored per event in `pii_fields`; DSAR exports read from Bronze/Silver with consent filtering.
- `dsar_request` rows drive deletion workflows: Bronze soft-delete flag + downstream purge job.
- Masking audit captured in `pii_mask_audit` with operator + justification to satisfy SOC 2 & GDPR.
- Attribution proofs (click tokens) stored separately; linkage enforced with hashed identifiers (see `analytics/attribution.md`).

## Cost & Access Controls

- Athena workgroups enforce partition filters and query byte caps (see `analytics/cost_controls.md`).
- QuickSight datasets pull from Gold summary tables to minimise scan costs.
- Lake Formation row-level security restricts Silver Private access to DS and Privacy teams.

## Cross-References

- `docs/data/analytics/architecture.md` — pipeline topology, identity graph, observability.
- `docs/data/analytics/experimentation.md` — CUPED/SRM integration requirements.
- `docs/data/analytics/data_quality.md` — expectation suites and DSAR automation.

## Outstanding Tasks

- Implement CI script (`tools/validate_event_contracts.py`) to diff manifest checksums vs registry.
- Build dbt project skeleton reflecting Silver/Gold models and experiment/attribution facts.
- Configure Step Functions playbook for DSAR deletion plus verification tests.
