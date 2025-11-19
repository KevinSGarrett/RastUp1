## WBS-017 Test Plan — Availability, Calendar Sync, Booking Feasibility

**Agent:** AGENT-3 (Frontend & Developer Experience)  
**Date:** 2025-11-19  
**Blueprint Coverage:** TD-0206 → TD-0210

### Objectives

- Validate deterministic availability computations (weekly rules, exceptions, DST, buffers).
- Protect booking feasibility invariants (lead time, booking window, min duration, holds/conflicts).
- Ensure calendar connect UX state machines handle sync states, polling feedback, and token rotation.
- Verify ICS helpers generate compliant `.ics` attachments/feeds and respect privacy toggles.

### Test Layers

- **Unit (Node `node:test`)**
  - `availability/weekly_rule` — expand weekday masks into local windows; handle DST transitions.
  - `availability/exceptions` — apply available/unavailable overrides; respect partial-day spans.
  - `feasibility/engine` — subtract holds, confirmed events, external busy blocks; enforce buffers and lead time.
  - `ics/helpers/outbound` — build ICS payloads (VEVENT + tokens/feeds), ensure deterministic UID generation and folding.
  - `ui/state` — reducers/stores for availability editor panels, calendar connect status, reschedule picker selection.
  - `controller` — orchestrates availability/connect/reschedule stores, hold lifecycle, external busy updates, telemetry sync.
  - `client` — GraphQL dashboard hydration, hold creation/release, booking integration guard rails, ICS connect/disconnect flows.
  - **Implemented suites:** `node --test tests/frontend/calendar/*.test.mjs` covering feasibility engine edge cases (DST, conflicts, booking window), ICS poller parsing/poller flows, ICS outbound feeds/invites, availability editor store diff tracking, connect store telemetry, reschedule picker filtering, controller orchestration, and GraphQL client behaviour.
- **Contract**
  - Mock GraphQL payload validations for `WeeklyRule`, `Exception`, `Hold`, `CalEvent`, `FeasibleSlot`.
  - Schema snapshot tests once `api/schema/calendar.graphql` lands (pending backend delivery).
- **Integration (Future)**
  - Headless engine + booking hold workflow to confirm atomic hold→event conversion using fixtures.
  - Calendar connect flow with simulated ICS poll responses (etag unchanged, modified, error).
  - Reschedule picker flows verifying slot recomputation on duration change.
- **E2E (Future)**
  - Playwright suite for availability editor UI, calendar connect wizard, booking checkout with lead time enforcement.
  - Email snapshot tests ensuring ICS attachments generated on confirm/reschedule/cancel.
- **Performance & Observability**
  - Bench harness for feasibility engine across dense schedules (pending).
  - Telemetry emission tests verifying event payloads (`cal.*`) align with Ops dashboards.

### Tooling & Coverage Targets

- **Runtime:** Node 20.x ESM modules (`node --test`), Python not required for frontend scope.
- **Command Targets:**  
  - `node --test tests/frontend/calendar/*.test.mjs`  
  - `node --test tests/frontend/**/*.test.mjs` (regression)  
  - `node --test tests/booking/*.test.mjs` (conflict guard)  
  - `make ci` (known missing target — document failure until pipeline exists)
- **Coverage Goals:** ≥85% statements for calendar headless modules; targeted branch coverage on DST/lead-time branches.
- **Static Analysis:** Pending addition of lint/format tasks (`make lint`), capture as risk.

### Exit Criteria

- All new calendar unit suites passing with documented outputs.
- Regression suites executed without new failures.
- Known gaps (integration, E2E, CI) enumerated in run report with follow-up recommendations.
