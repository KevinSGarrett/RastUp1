# Calendar Availability & Sync Dashboard

**Scope:** WBS-017 · Availability, Feasibility, Calendar Sync  
**Owners:** AGENT-3 (Frontend & DX), AGENT-D (Ops/Observability)  
**Last Updated:** 2025-11-19

---

## 1. Purpose

Monitor the end-to-end health of provider availability, feasibility computation, and calendar synchronisation workflows. Surface actionable KPIs, saturation signals, and error rates required to keep Instant Book (IB) and Request-to-Book (RTB) experiences reliable.

---

## 2. Key Dashboards

| Panel | Description | Signals |
| --- | --- | --- |
| **Availability Intake** | Coverage and freshness of weekly rules & exceptions. | `cal.rule.updated` count, distinct providers configured, exception volume, stale configuration (>7d). |
| **Feasibility Engine** | Slot generation throughput and latency. | Lambda invocations, `cal.feasible.cache.hit/miss`, compute duration p50/p95/p99, candidate windows truncated. |
| **Hold to Confirm** | Funnel from slot selection → hold → conversion. | Holds created vs confirmed vs expired, overlap rejection rate, avg TTL consumption. |
| **External Calendar Sync** | ICS poller health and backlog. | Poll success/error counts, `cal.ics.poll.ok/error`, backlog size, retry tier, payload bytes, median diff between polls. |
| **ICS Feed Outbound** | Token usage and refresh cadence. | Feed generation count, attachment generation success, token regeneration incidents. |
| **User Impact** | surfaced availability to buyers. | Slots surfaced to search, IB acceptance rate, reschedule rebooking latency, support tickets tagged “calendar”. |

Each panel links to CloudWatch/CloudWatch Logs insights for drill-down plus Step Functions traces where applicable.

---

## 3. Core Metrics & Events

- **Feasibility**
  - `cal.feasible.generated` – emitted with `slot_count`, `candidate_windows`, `duration_ms`, `truncated`.
  - `cal.feasible.cache.hit|miss` – 5m TTL cache effectiveness.
  - `cal.hold.created|expired|converted` – hold lifecycle with `source`, `ttl_minutes`, `overlap_detected`.
- **Configuration**
  - `cal.rule.updated` – rule mutations with `weekday_mask`, `timezone`, `lead_time_hours`.
  - `cal.exception.upserted` – override creation with `kind`, `span_minutes`.
- **External Sync**
  - `cal.ics.poll.ok|error` – poll attempt outcome; tags include `src_id`, `http_status`, `etag_matched`, `delta_event_count`.
  - `cal.ics.feed.requested` – outbound feed downloads with `include_holds`.
- **UI Telemetry**
  - `cal.ui.weekly_rule.updated`, `cal.ui.exception.added`, `cal.ui.sync.retry`, `cal.ui.hold.create`.
  - React components tie telemetry to user/session IDs for funnel attribution.

All metrics aggregated per provider, role, and region to support slicing.

---

## 4. Alerts & Thresholds

| Alert | Trigger | Action |
| --- | --- | --- |
| **Feasibility Latency** | `p95(cal.feasible.generated.duration_ms) > 2000` for 5 mins. | Page Ops; check Lambda concurrency, Dynamo TTL backlog, recent deploys. |
| **Hold Expiry Spike** | `cal.hold.expired / cal.hold.created > 0.2` over 15 mins. | Investigate overlapping holds, slot staleness; verify search cache invalidation. |
| **ICS Poll Errors** | `cal.ics.poll.error` rate >5% or backlog > predetermined queue size. | Follow runbook `ops/runbooks/calendar-ics-errors.md`. Evaluate remote service status. |
| **Sync Staleness** | Max `now - last_poll_at` > 45 mins for active sources. | Trigger manual poll, notify provider. |
| **Feed Token Leakage** | >3 feed regenerations per provider within 24h or anomaly detection on requests. | Rotate tokens, audit access, notify security. |
| **Dashboard Silence** | No `cal.rule.updated` or `cal.feasible.generated` events for >30 mins during business hours. | Validate ingestion pipeline, confirm not a planned outage. |

Alert delivery via PagerDuty (Ops) and Slack `#calendars-observability`.

---

## 5. Dependencies & Instrumentation Notes

- **Event Sources**: AppSync resolvers, feasibility Lambda, ICS poller Workers, Booking Saga.
- **Storage**: DynamoDB cache TTL metrics, Aurora `cal.*` tables for ground truth.
- **Tracing**: X-Ray segments include `feasibility.compute`, `ics.poll`, `hold.create`. Span attributes mirrored into metrics for high-cardinality debugging.
- **Telemetry SDK**: Frontend components emit via `tools/frontend/calendar/index.mjs` helper ensuring consistent payloads.

---

## 6. Runbook Links

- `ops/runbooks/calendar-ics-errors.md` – ICS poller failure handling.
- `ops/runbooks/booking-hold-degradation.md` (WBS-005) – shared hold/booking incident response.
- `ops/runbooks/search-slot-anomalies.md` (WBS-002) – cross-reference if search feed issues appear.

---

## 7. Future Enhancements

- Add anomaly detection on feasible slot volume per cohort.
- Incorporate synthetic ICS pollers to detect credential expiry ahead of production impact.
- Integrate Playwright synthetic journeys (Availability Editor, Calendar Connect) for UI heartbeat metrics.
