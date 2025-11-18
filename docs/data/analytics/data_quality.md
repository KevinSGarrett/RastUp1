# Data Quality, Lineage, and DSAR Automation

Status: Draft v0.1  
Owner: Data Platform QA  
Scope: WBS-020 — automated expectations, lineage, retention, and DSAR enforcement across Bronze/Silver/Gold.

## 1. Quality Pillars

1. **Schema fidelity** — Event payloads adhere to JSON Schemas (Bronze gate).
2. **Completeness** — No unexpected drops in volume vs baselines (per event and per KPI).
3. **Consistency** — Referential integrity and surrogate key stability in Silver.
4. **Accuracy** — Metrics derived from Gold align with finance/trust systems.
5. **Timeliness** — SLA: Bronze ≤60s, Silver ≤15 min, Gold ≤6h after day end.
6. **Privacy & retention** — Enforce masking, DSAR deletion, and legal holds.

## 2. Great Expectations Coverage

| Suite | Scope | Expectations | Schedule |
|-------|-------|--------------|----------|
| `bronze_event_contracts.yml` | Ingested raw events | `expect_column_values_to_match_json_schema`, `expect_column_values_to_not_be_null` | Continuous (stream) |
| `silver_fact_integrity.yml` | Facts/dims (bookings, payments, messaging) | `expect_compound_columns_to_be_unique`, `expect_foreign_keys_to_exist`, thresholds for monetary amounts | Hourly |
| `gold_kpi_sanity.yml` | Gold KPIs (GMV, conversion, disputes) | Trend bounds vs 7-day avg, value ranges, percentile spikes | Daily @ 06:00 |
| `privacy_purge.yml` | `silver_private` tables | Ensures DSAR tombstones applied, zero rows older than retention windows | Nightly |

- Suites stored in `data_quality/suites/*.yml` (to be implemented).
- Execution orchestrated by Dagster (preferred) or Managed Airflow; results logged to `data_quality_run` table with `status`, `row_count`, `error_count`, `expectation_suite`.

## 3. Deequ / Spark Checks (Optional)

- For large tables (e.g., `fact_search_impressions`), run Deequ anomaly checks on row counts and numeric distributions.
- Integration plan:
  - Glue job triggers Deequ checks post-write.
  - Results saved to `data_quality_metrics` table (S3-backed) for trend analysis.

## 4. Lineage Tracking

- dbt generates lineage JSON (`manifest.json`) with node dependencies.
- `lineage_edge` table (Aurora) stores `source_node`, `target_node`, `edge_type`, `last_refreshed_at`.
- Dagster callback posts events to DataHub (future) to render full DAG.
- For non-dbt jobs (Glue streaming, Lambda), we emit `lineage.event` messages consumed by `lineage_harvester`.

## 5. DSAR Automation

### Data Flow

1. DSAR request inserted into `dsar_request` (`request_type`, `scope`, `status`).
2. `dsar_orchestrator` Step Function branches:
   - **Export**: queries Bronze/Silver tables filtered by `identity_id`, drops restricted columns, packages into AES-256 zip stored in S3.
   - **Delete**: writes tombstone to `dsar_tombstone` table.
3. Tombstone Lambda updates:
   - Bronze read filter (DynamoDB) to exclude identifiers.
   - Kicks off Glue job to purge Silver/Gold partitions.
4. `dsar_audit_log` records steps, completion timestamp, operator.

### Controls

- Retention windows encoded in metadata table `data_retention_policy` (`dataset`, `retention_days`, `legal_hold_flag`).
- CI checks ensure new tables register retention + privacy tier metadata.
- Deletion job idempotent via `deletion_version` to prevent duplicate purges.

## 6. Alerting & Incident Response

- PagerDuty triggers:
  - Quality suite failure severity mapping: Bronze (P1), Silver (P1), Gold (P0 for GMV, P1 otherwise).
  - DSAR job stale > 24h (P1).
  - Retention backlog > 3 days (P2).
- Runbook in `runbooks.md` outlines triage: identify affected dataset, rollback vs hotfix, communication path.
- All failures recorded in `data_incident` table with root cause, fix summary, follow-up actions.

## 7. Compliance & Auditability

- Maintain evidence snapshots (`s3://compliance-artifacts/data-quality/yyyymmdd/`) with expectation results, DSAR job logs, retention reports.
- Quarterly audit exports list:
  - All DSAR requests with completion proof hash.
  - Retention deletions (dataset, partitions removed, operator).
  - Quality suite pass/fail trends.
- Provide interface for Compliance to acknowledge incidents and attach remediation evidence.

## 8. Open Items

- Implement `tools/audit_dsar_consistency.py` to reconcile DSAR deletions across Aurora + S3 (deferred).
- Evaluate AWS Clean Rooms for privacy-preserving analytics (future).
- Integrate Monte Carlo or Databand for real-time lineage impacts (optional).
