# Test Plan — Communications & Notifications System

## Purpose

Define verification strategy and required coverage to satisfy WBS-015 acceptance criteria across routing, delivery, suppression, compliance, localization, experiments, and admin experiences.

## Test Governance

- **Owner:** QA Lead (Agent D), supported by Comms Core (Agent B) and Integrations (Agent C).
- **Test Environments:** `rastup-dev` (feature validation), `rastup-stage` (pre-prod), sandbox accounts for SES/Pinpoint/Twilio.
- **CI Triggers:** Pull requests touching `services/booking`, `services/notifications`, `docs/ops/communications/**`, `tools/comms/**`, `tests/**/comms_*`.
- **Success Criteria:** All automated suites green; manual checklists executed before production release; attach pack includes `tests.txt` with commands/outcomes.

## Test Matrix

| Area | Objective | Type | Tools | Frequency |
|------|-----------|------|-------|-----------|
| Routing | Preferences, quiet hours, dedupe, batching, critical overrides | Unit + Integration | Jest/Node, Python unittest, Step Functions canary | Per PR |
| Templates | Variables present, localization fallback, accessibility | Static + Visual Snapshot | MJML lint, Storybook Chromatic, i18n validators | Per PR + nightly |
| Deliverability | SPF/DKIM/DMARC alignment, warmup adherence | Integration + Monitoring | `aws ses`, DMARC analyzer, synthetic probes | Stage + prod daily |
| Suppression | Bounce/complaint ingestion, unsubscribe flows | Integration | Localstack, SES/Twilio sandbox, pytest | Per PR |
| Link Tracking & Privacy | Tracking toggles, DNT compliance, UTM sanitization | Unit + Integration | Jest, Cypress API tests | Per PR |
| In-App Notification Center | Pagination, grouping, pinning, retention | Component + E2E | Playwright, GraphQL mocks | Weekly |
| Experiments | Variant bucketing stability, guardrail rollback | Simulation | Python property-based tests, Looker anomaly detection | Nightly |
| Admin Console | Dual approval, audit logging, RBAC | E2E + Integration | Playwright, Amplify mock, IAM simulator | Weekly |
| Performance | Queue latency, throughput under burst | Load | K6, Step Functions | Weekly |
| Cost Controls | SMS spend caps, AppConfig toggles | Integration | pytest, AWS budget API mocks | Per release |

## Automated Test Suites

1. **Unit Tests**
   - `tests/javascript/comms/router.test.mjs` — rule evaluation, quiet hour scheduling, dedupe keys.
   - `tests/python/test_comms_templates.py` — ensures templates register required variables, no placeholders.
   - `tests/python/test_comms_privacy.py` — asserts tracking toggles for sensitive categories.
2. **Integration Tests**
   - `tests/python/test_comms_suppression.py` — bounce/complaint ingestion via Localstack SNS.
   - `tests/frontend/comms_admin.test.mjs` — Playwright admin flows with dual approval.
   - `tests/python/test_comms_link_wrapper.py` — verifies HMAC tokens redirect + log.
3. **End-to-End Tests**
   - `tests/e2e/comms_digest.spec.ts` — Stage environment daily digest pipeline validation.
   - `tests/e2e/inapp_notifications.spec.ts` — AppSync fetch performance + pinning.
4. **Performance / Synthetic**
   - Step Functions `CommsLoadTest` orchestrates 10k events over 15 minutes; monitors SLO metrics.
   - Scheduled SES/Twilio sandbox sends recorded in CloudWatch custom metrics.

## Manual Verification

- Accessibility review for top templates (screen reader, color contrast).
- Localization QA with native speakers for `es-US`, `fr-CA`, expansions.
- Legal review of unsubscribe landing page, audit logs, terms updates.
- Finance approval for SMS budget thresholds before enabling new geos.

## Test Data Management

- Seed scripts populate synthetic users with preferences and quiet hours.
- Template fixtures stored under `docs/data/comms/templates/`.
- Bounce/complaint payload samples maintained in `docs/data/comms/provider_samples.json`.
- Test data sanitized post-run; PII masked in logs via central redaction policy.

## Reporting & Exit Criteria

- CI publishes coverage reports (>85% comms modules), lint results, and synthetic probe metrics.
- Release checklist: attach pack includes `tests.txt`, `performance-security.txt`, diff summary, manifest referencing blueprint IDs.
- Production release requires 48h synthetic green, bounce/complaint rates below guardrails, admin dual approval logs verified.

## Future Enhancements

- Integrate chaos testing (queue failure simulation).
- Expand real-device push notifications test lab (iOS/Android).
- Add automated verification for quiet-hour timezone transitions (DST changes).
- Build generative test harness to fuzz template variables and ensure graceful degradation.

