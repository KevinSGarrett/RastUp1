# Data Architecture Seed (WBS-002 → WBS-020)

Artifacts produced by AGENT-1 on 2025-11-18 to bootstrap the Core Data Models & Event Contracts initiative, now extended for the Analytics, Experimentation, and Data Quality scope (WBS-020).

## Directory Map

- `aurora/` — canonical SQL DDL + overview notes for relational store.
- `events/` — JSON Schema contracts, manifest with checksums, and registry notes.
- `pipelines/` — Bronze/Silver/Gold processing plan including quality, privacy, identity stitching, and cost notes.
- `privacy/` — DSAR playbook, retention tiers, monitoring requirements.
- `semantic_layer/` — metrics catalog bridging Gold facts to business KPIs.
- `analytics/` — WBS-020 analytics lakehouse architecture, experimentation framework, attribution, data quality, dashboards, cost controls, and runbooks.

## Next Steps (Hand-off)

1. Scaffold migration tooling to turn `aurora/core_schema.sql` into versioned migrations.
2. Implement CI script (`tools/validate_event_contracts.py`) enforcing manifest integrity and schema linting.
3. Stand up dbt/dagster project referencing Bronze/Silver/Gold pipeline and analytics architecture.
4. Wire DSAR orchestration into support tooling; ensure logging into `pii_mask_audit`.
5. Operationalise experimentation registry, CUPED jobs, and data quality suites described in `analytics/`.

Refer back to `ops/tasks/AGENT-1/WBS-002-20251118-071911Z.md` for full blueprint context and acceptance criteria. This directory is the working source for iteration #1.
