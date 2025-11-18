# Search Index Runbook

**Updated:** 2025-11-18  
**Owners:** Search Engineering (AGENT-2), DevOps (AGENT-1)  
**Scope:** Typesense/OpenSearch indexing pipeline, outbox ingestion, promotions integrity.

---

## 1. Architecture Summary

- Aurora `search.outbox` table receives normalized payloads from application services (upsert/delete).
- Lambda-based indexer (`services/search/indexer.ts`) polls outbox, batches by surface, writes to Typesense primary node.
- OpenSearch fallback adapter hot-standby; toggled via feature flag if Typesense unhealthy.
- Dynamo cache stores normalized search responses (SWR pattern) and cursor digests.
- Telemetry emitted via `search.*` and `promo.*` events; CloudWatch dashboards defined in `observability/dashboards/search.md`.

## 2. Regular Operations

| Task | Frequency | Steps |
| --- | --- | --- |
| Validate Typesense health | Hourly | `curl $TYPESENSE_HOST/health` → expect `OK`; slate if latency \> 250 ms |
| Check outbox backlog | Hourly | `select count(*) from search.outbox where processed=false;` alert if \> 300 |
| Synonym review | Daily | Export via `typesense-cli synonyms list`; ensure two-person approval |
| Promotions audit | Daily | Review QS distribution dashboard, confirm density caps respected |
| Cache hit review | Daily | Dashboard `Search API Health` → maintain ≥60% hit rate |

## 3. Incident Response

### 3.1 Typesense outage / high latency

1. Confirm via `search_latency_p95_breach` alert + `/health` endpoint.
2. Switch feature flag `search.engine=OPENSEARCH` (AppConfig) — managed by DevOps.
3. Scale Typesense node (increase CPU/memory) or restart container.
4. Rebuild index if data divergence detected:
   - Trigger `adminReindex(surface, city)` GraphQL mutation (dry-run first).
   - Validate doc counts vs DB.
5. Post-incident: revert flag, backfill missed outbox events (`update search.outbox set processed=false where processed=true and processed_at >= :incident_start` with caution).

### 3.2 Outbox backlog growth

1. Inspect `search.outbox_dlq` for poison records.
2. For recoverable errors (e.g., Typesense 409), requeue with `update search.outbox set processed=false, retry_count=retry_count+1 where event_id in (...)`.
3. If payload malformed, fix upstream normalization, then manual patch doc via admin reindex.
4. Alert Trust & Safety if backlog caused by mass takedown.

### 3.3 Promotions density violation

1. Dashboard alert `promotion_density_violation`.
2. Fetch config from admin console: ensure `featuredSlots`, `featuredMaxAboveFold`, `boostFrequency` unchanged.
3. Inspect promotions QS export; verify candidates not exceeding caps.
4. Temporarily disable promotions flag or reduce `featuredSlots` to 0 until resolved.

### 3.4 Invalid click spike

1. Confirm `promo.invalid_click.flag` rate.
2. Review IP/device dedupe heuristics; blacklist offending sources in WAF.
3. Issue make-good credits automatically (ledger job).
4. Communicate to Finance if refunds exceed daily threshold.

## 4. Maintenance Procedures

- **Synonym import/export**
  1. Export current synonyms: `typesense-cli synonyms list > synonyms.json`.
  2. Update `ops/typesense/collections.json` in repo.
  3. Apply via `typesense-cli synonyms upsert synonyms.json`.
  4. Record change in audit log (requires two approvals).

- **Feature flag changes**
  - Flags stored in AppConfig `search-service`.
  - Use change request template, include blast radius, rollback plan, 2 approvals for paid placement changes.

- **Schema migrations**
  - Apply SQL from `db/migrations/025_search_outbox.sql` via standard migration tool.
  - Ensure `search.outbox_dlq` retention policy (30 days) enforced via scheduled job.

## 5. DR / Backfill

- Nightly job `search-backfill` per city ensures index parity.
- For full rebuild:
  1. Pause indexer Lambda.
  2. Purge Typesense collection (`/collections/{name}` delete).
  3. Stream data from Aurora (materialized view) into batch upsert.
  4. Resume indexer, monitor lag until zero.

## 6. Contact & Escalation

- Primary on-call: Search Engineering Slack `#search-oncall`.
- Escalation: DevOps PagerDuty `Search API`.
- Finance contact (promotions billing): `finance-growth@rastup`.
- Trust & Safety contact (safe-mode override issues): `tands@rastup`.

## 7. References & Links

- [Typesense documentation](https://typesense.org/docs/)
- [OpenSearch serverless guide](https://docs.aws.amazon.com/opensearch-service/)
- `docs/data/search/implementation_plan.md`
- `observability/dashboards/search.md`
- `services/search/*` source modules

---

**Checklist**

- [ ] Review Typesense health
- [ ] Validate cache hit rate ≥ target
- [ ] Inspect promotions integrity dashboard
- [ ] Confirm outbox backlog \< 300 records
