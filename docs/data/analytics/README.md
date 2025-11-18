# Analytics & Experimentation (WBS-020)

This directory captures the WBS-020 deliverables for analytics pipelines, experimentation, attribution, and governance. It expands on the WBS-002 bootstrap by specifying how events move from ingestion to decision-making, how experiments are executed safely, and how we uphold privacy, quality, and cost targets.

## Document Map

- `architecture.md` — End-to-end architecture covering ingestion, schema validation, identity stitching, storage tiers, serving, and observability.
- `attribution.md` — Click-token proof model, channel grouping taxonomy, and attribution ingestion/serving workflow.
- `experimentation.md` — Assignment, CUPED adjustments, SRM guardrails, preregistration, and analyst workflow.
- `data_quality.md` — Data quality controls, automated expectations, lineage, DSAR automation, and retention enforcement.
- `bi_dashboards.md` — Dashboard catalog (Marketplace, Growth, Trust & Safety, Finance, Support) with owners, inputs, and refresh SLAs.
- `cost_controls.md` — Budgets, query governance, resource rightsizing, and anomaly alerting for analytics spend.
- `runbooks.md` — Operational playbooks for data governance changes, incident response, and compliance posture.

## Blueprint References

- TD-0066 through TD-0075 (analytics lakehouse, identity stitching, attribution)
- TD-0076 through TD-0085 (experimentation framework, CUPED, SRM)
- TD-0086 through TD-0095 (data quality, lineage, DSAR automation)
- TD-0096 through TD-0105 (BI and cost controls)
- TD-0106 through TD-0125 (security, privacy, governance, runbooks)

Each document enumerates open questions, assumptions, and next actions for follow-up agents. Update this index whenever new analytics artifacts are added.
