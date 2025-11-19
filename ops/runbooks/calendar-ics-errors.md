# Runbook: Calendar ICS Poller Errors

**Service:** Calendar Sync (WBS-017)  
**Primary Pager:** Ops – Calendars Rotation  
**Secondary Contacts:** AGENT-3 (Frontend & DX), AGENT-B (External Sync)  
**Last Updated:** 2025-11-19

---

## 1. When to Trigger

Alert sources:

- PagerDuty alert **ICS Poll Errors** (from `observability/dashboards/calendar.md`).
- Sustained backlog growth in `cal.ics.poll` queue > 3× baseline.
- Provider tickets reporting stale availability despite connected calendars.
- Grafana/CloudWatch panel “External Calendar Sync” showing error rate >5%.

---

## 2. Quick Triage Checklist

1. **Confirm scope**
   - Identify affected `src_id` values from alert payloads.
   - Inspect most recent logs in `/aws/lambda/calendar-ics-poller` filtered by `src_id`.
2. **Check remote status**
   - Review HTTP status codes: `401/403` (credential), `404` (URL removed), `5xx` (remote outage).
   - For Google/Microsoft connectors, confirm OAuth token validity in Secrets Manager.
3. **Backlog assessment**
   - Query Dynamo `cal.external_source` for `status`, `last_poll_at`, `retry_count`.
   - Inspect SQS or Step Function queue depth for poller tasks; throttled > concurrency? increase temporarily.
4. **Recent deploys**
   - Check deploy pipeline for poller/feasibility changes within last 1 hr. Rollback if correlated.
5. **Downstream impact**
   - Validate feasibility cache TTL — stale external busy data can cause double-bookings. Notify Booking Ops if high severity.

---

## 3. Detailed Remediation Steps

### 3.1 Credential / Auth Failures (4xx)

1. Rotate OAuth/ICS credentials:
   - For ICS URLs, revalidate the URL with provider (often rotated by source service).
   - For OAuth connectors, trigger automated token refresh via `calendar-sync rotate-token --src <src_id>`.
2. Update `cal.external_source.status` to `paused` while retrying, to avoid repeated noise.
3. Notify provider via CRM template **CAL-ICS-401** with instructions to regenerate private link.

### 3.2 Remote Outage / 5xx

1. Switch poller to exponential backoff tier (`backoffTier = 3`) using `calendar-sync backoff --src <src_id> --tier 3`.
2. Monitor vendor status dashboards; document outage start/end in incident channel.
3. If outage > 1h, notify providers via status page; consider temporarily disabling Instant Book for affected providers.

### 3.3 Payload / Parsing Errors

1. Retrieve failing payload from S3 dead-letter bucket `calendar-ics-dlq/<src_id>/<timestamp>.ics`.
2. Run parser locally: `node tools/diagnostics/parse-ics.mjs <file>` to reproduce.
3. Common fixes:
   - Large payload (>5 MB) → enable chunked processing flag, coordinate with Platform to raise limit.
   - Unsupported RRULE → open engineering ticket `CAL-WBS017-ICS-<date>` with sample; fallback to marking event as `busy`.
4. Patch `services/calendar/ics-poller.js` as needed; run unit tests `node --test tests/frontend/calendar/ics-poller.test.mjs` before deploy.

---

## 4. Post-Incident Actions

- Update status page and provider comms once resolved.
- Backfill missed polls:
  - Run `calendar-sync replay --src <src_id> --since <ISO timestamp>`.
  - Validate Delta events inserted into `cal.external_event`.
- Add timeline & metrics snapshot to incident doc within 24 hours.
- File follow-up JIRA if automation or monitoring gaps observed.

---

## 5. References

- Metrics dashboard: `observability/dashboards/calendar.md`
- Schema: `db/migrations/020_calendar.sql`
- Engine tests: `tests/frontend/calendar/ics-poller.test.mjs`
- CLI utilities (placeholder): `tools/frontend/calendar/index.mjs` telemetry helpers

---

## 6. Revision History

| Date | Author | Summary |
| --- | --- | --- |
| 2025-11-19 | AGENT-3 | Initial runbook for WBS-017 ICS poller. |
