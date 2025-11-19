# Communications & Notifications System Blueprint — WBS-015

## Context

- **Owner:** AGENT-1 (Bootstrap & DevOps)
- **Workstream:** WBS-015 — Communications and Notifications System
- **Blueprint references:** TD-0050 · TD-0051 · TD-0052 · TD-0053 · TD-0054 · TD-0055 · TD-0056
- **Dependencies:** WBS-001 (infrastructure bootstrap), WBS-002 (core platform data), shared identity/auth services, analytics pipelines.
- **Objectives:** Deliver a cost-efficient, privacy-safe, multi-channel communications layer spanning email (SES), push (FCM/APNs), SMS (SNS/Twilio), and in-app surfaces with user preferences, quiet hours, localization, experiments, observability, and compliance built in.

## Scope Overview

1. **Comms Router** — Event-driven rules engine orchestrating channel selection, preference enforcement, quiet hours scheduling, dedupe, batching, and idempotency.
2. **Template Service** — Versioned MJML templates with localization, variable schema definitions, A/B test hooks, and immutable renders stored in S3.
3. **Channel Workers** — Provider-specific delivery workers for SES email, FCM/APNs push, SNS/Twilio SMS, and in-app notifications (AppSync + Aurora persistence).
4. **Deliverability & Compliance** — SPF/DKIM/DMARC, bounce/complaint handling, suppression lists, quiet hour overrides for critical flows, List-Unsubscribe enforcement, TCPA/CAN-SPAM hygiene.
5. **Admin Console** — Template lifecycle management, suppression viewer, campaign/digest configuration, audit trails with dual approval workflows.
6. **Observability & Cost Controls** — Metrics, dashboards, alerts, synthetic probes, cost envelopes per channel, warmup planning.
7. **Testing & QA** — Automated coverage for routing, suppression, deliverability, localization, experiments, and admin actions; sandbox provider integrations.

## Canon & Invariants

- **User control first:** Preferences and quiet hours enforced for all non-critical communications; opt-in per channel/category with locale-aware defaults.
- **Critical vs non-critical:** Security, legal, receipts bypass quiet hours and opt-out except where regulatory consent requires fallback channel.
- **Idempotent delivery:** `(template_name, template_version, user_id, cause_ref)` forms the core idempotency key across router and workers.
- **Immutable renders:** Every outbound message references a rendered artifact (HTML, JSON, or text) stored under `s3://comms-rendered/{msg_id}` for auditability.
- **Privacy by design:** Link tracking disabled for sensitive templates; DNT honoured; SMS payloads minimized; opt-out accessible via List-Unsubscribe and settings.
- **Cost aware:** Email via SES (shared IPs with warmup path for dedicated), push via FCM/APNs with collapse keys, SMS via SNS with Twilio fallback gated by cost, in-app preferred when viable.

## High-Level Architecture

```
                          +---------------------+
Domain Event (EventBridge)|  Comms Intake Lambda|--+
                          +----------+----------+  |
                                     |             |
                                     v             |
                              +---------------+    |
                              | Comms Router  |<---+-- Template Catalog & Preferences DB
                              +-------+-------+
                                      |
                    +-----------------+-------------------------+
                    |                 |                         |
                    v                 v                         v
          +----------------+  +-----------------+      +-----------------+
          | Email Worker   |  | Push Worker     |      | SMS Worker      |
          | (SES queue)    |  | (FCM/APNs queue)|      | (SNS/Twilio)    |
          +--------+-------+  +--------+--------+      +--------+--------+
                   |                   |                        |
                   v                   v                        v
               Amazon SES        FCM/APNs Providers          SNS/Twilio
                   |
                   v
      Bounce/Complaint Webhooks (API Gateway + Lambda)

                    |
                    v
          Suppression Processor (Aurora/DynamoDB)

   +-------------------------------------+
   | In-App Worker (AppSync + Aurora)    |
   +-------------------------------------+
```

### Event Intake & Routing

- **Event Source:** EventBridge bus `comms.events` collects domain events (booking lifecycle, docs, payments, messaging, trust, promotions) with payload metadata (`name`, `actors`, `cause_ref`, `payload`, `priority`, `category`).
- **Router Implementation:** AWS Lambda (Python/TypeScript) using decider plugins per event type. It:
  - Resolves recipient personas (buyer, seller, admin) with locale/timezone.
  - Fetches category/channel defaults, preferences, and quiet hours from Aurora (`comms_pref`, `comms_quiet_hours`).
  - Computes dedupe key (payload-driven) with DynamoDB `comms_dedupe` TTL 5 minutes.
  - Schedules digest batches via SQS FIFO queue when batching configured.
  - Renders payload (MJML → HTML via `@mjml/node`, JSON for push/in-app) referencing template version.
- **Scheduling:** Non-critical messages outside quiet hours stored in DynamoDB `comms_scheduled` table with TTL; EventBridge Scheduler triggers deferred send.
- **Error Taxonomy:** Router returns typed errors (`COMMS_PREF_BLOCKED`, `COMMS_QUIET_HOURS`, `COMMS_TEMPLATE_MISSING_VAR`, etc.) for analytics and admin visibility.

### Template Catalog & Rendering

- **Storage:** Aurora Postgres `comms_template` table (see §Data Model). MJML stored as text; compiled HTML cached in S3 per publish.
- **Versioning:** `published_at` timestamp and `is_active` flag allow staged rollouts and experiments. Dual approval required for critical categories (security, legal).
- **Localization:** Templates keyed by locale; fallback chain `user_locale → Accept-Language → city_default → en-US`.
- **Variable Schemas:** JSON schema per template ensures renderers validate required variables; build-time tests ensure schema coverage.
- **Experimentation:** `experiment_config` JSON field stores variant weights and guardrails. Router uses feature flag service (AppConfig) to assign user bucket (salted hash).
- **MJML Pipeline:** Codebuild job compiles MJML to inlined HTML; lint ensures accessibility (table structure, alt text) and dark-mode safe colors.

### Channel Workers

- **Email (SES):**
  - SQS queue `comms-email` with redrive policy.
  - Lambda worker injects `List-Unsubscribe`, `Message-Id`, `X-Template-Name`, `X-Template-Version`.
  - Uploads rendered HTML to S3, records `comms_message` row with status `queued`→`sent`.
  - Event destinations forward bounce/complaint/delivery events to SNS `comms-ses-feedback`.
- **Push (FCM/APNs):**
  - Per-platform SQS queues; worker handles token fan-out via `comms_tokens` (DynamoDB).
  - Applies `collapse_key`/`thread_id`, handles localized payload, prunes invalid tokens.
  - Feedback (APNs/APNS) ingested via Lambda cron removing stale tokens.
- **SMS (SNS/Twilio):**
  - SNS SMS primary; Twilio adapter behind feature flag for geos lacking SNS support.
  - Enforces cost gating via AppConfig `sms.allowed_categories`.
  - Attaches STOP/HELP footers with locale-specific phrasing.
- **In-App:**
  - Router writes to Aurora `inapp_notification` table and publishes to AppSync subscription for realtime updates.
  - Notification center queries via GraphQL resolvers with cursor pagination and grouping.

### Deliverability & Suppression Pipeline

- SES + Twilio webhooks (API Gateway + Lambda) push events to Kinesis stream `comms-feedback`.
- Suppression processor Lambda:
  - Hashes addresses (`SHA256`) and upserts into `comms_suppression`.
  - Updates `comms_message.status` to `bounced`/`complained`.
  - Triggers admin alerts when thresholds exceeded (SES bounce rate >0.3%, complaint >0.1%).
- Soft bounce retry policy tracked via DynamoDB `comms_soft_bounce` with attempt counters.
- Global blocklist maintained in `ops/config/comms_blocklist.json` (source of truth for legal compliance).

### Preferences, Quiet Hours & List-Unsubscribe

- GraphQL schema (AppSync) exposes `CommsPreference` and `QuietHours` type/resolvers backed by Aurora.
- `unsubscribeAllEmail` mutation sets all non-critical email categories to `opted_in = false`.
- List-Unsubscribe header directs to CloudFront-hosted endpoint `https://notify.rastup.com/unsubscribe/{token}` (signed JWT). Endpoint:
  - Validates token (`user_id`, `category`, `expires`).
  - Applies suppression if marketing category.
  - Records audit entry in `comms_audit` table.

### Experiments & Localization

- Feature flag assignments via AWS AppConfig `comms-experiments`. Router uses salted user hash to assign to variant.
- Experiment guardrails integrated with metrics pipeline (CloudWatch + Looker). Automatic rollback triggered when bounce/complaint guardrails breached for variant.
- Localization pipeline ensures CLDR pluralization via ICU libraries; template QA includes RTL preview.

## Data Model (Aurora Postgres)

```sql
create table if not exists comms_template (
    template_id text primary key,
    name text not null,
    version int not null,
    channel text not null check (channel in ('email','push','sms','inapp')),
    locale text not null default 'en-US',
    category text not null,
    subject_mjml text,
    body_mjml text,
    body_text text,
    push_json jsonb,
    sms_text text,
    inapp_json jsonb,
    variables_json jsonb not null,
    experiment_config jsonb default '{}'::jsonb,
    is_active boolean default true,
    created_by text not null,
    created_at timestamptz not null default now(),
    published_at timestamptz,
    unique (name, version, locale, channel)
);

create table if not exists comms_category (
    category_id text primary key,
    key text unique not null,
    description text not null,
    critical boolean not null default false
);

create table if not exists comms_pref (
    pref_id text primary key,
    user_id text not null,
    channel text not null check (channel in ('email','push','sms','inapp')),
    category_key text not null references comms_category(key),
    opted_in boolean not null default true,
    updated_at timestamptz not null default now(),
    unique (user_id, channel, category_key)
);

create table if not exists comms_quiet_hours (
    user_id text primary key,
    tz text not null,
    start_local time not null,
    end_local time not null,
    allow_categories text[] default '{}'
);

create table if not exists comms_message (
    msg_id text primary key,
    user_id text not null,
    channel text not null,
    template_name text not null,
    template_version int not null,
    category_key text not null,
    locale text not null,
    dedupe_key text not null,
    subject text,
    body_rendered_s3 text,
    body_text text,
    status text not null check (status in ('queued','sent','delivered','bounced','complained','dropped','suppressed','failed')),
    provider_ref text,
    cause_event text not null,
    cause_ref text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    experiment_variant text,
    metadata jsonb default '{}'::jsonb
);

create table if not exists comms_suppression (
    suppress_id text primary key,
    channel text not null,
    address_hash text not null,
    reason text not null check (reason in ('hard_bounce','complaint','manual')),
    created_at timestamptz not null default now(),
    unique (channel, address_hash)
);

create table if not exists comms_audit (
    audit_id text primary key,
    actor text not null,          -- user/admin/system
    action text not null,
    target jsonb not null,
    reason text,
    created_at timestamptz not null default now()
);

create table if not exists inapp_notification (
    inapp_id text primary key,
    user_id text not null,
    category_key text not null,
    title text not null,
    body text not null,
    deep_link text,
    unread boolean not null default true,
    created_at timestamptz not null default now(),
    pinned boolean not null default false,
    expires_at timestamptz
);
```

### DynamoDB Tables

- `comms_tokens` — Partition key `user_id`, sort key `device_id`; attributes: `platform`, `locale`, `last_seen`, `invalid_attempts`.
- `comms_dedupe` — Key `dedupe_key`; TTL 5 minutes; value stores `msg_id`, `expires_at`.
- `comms_queue_cursor` — Supports stable pagination for digests.
- `comms_scheduled` — Stores deferred notifications with `send_at`, `payload`.
- `comms_soft_bounce` — Tracks soft bounce counts with TTL 72 hours.

### S3 Buckets

- `comms-rendered` — Versioned bucket storing HTML/PDF renders.
- `comms-link-wrapper` — Static site hosting redirect endpoint (CloudFront).
- `comms-admin-exports` — Access-controlled bucket for template exports and suppression audit reports.

## Template Catalog (MVP Coverage)

- **Booking:** `booking_confirmed_buyer`, `booking_confirmed_seller`, `booking_rescheduled`, `booking_cancellation_outcome`.
- **Docs:** `doc_sign_request`, `doc_sign_reminder`, `doc_complete`.
- **Payments:** `charge_receipt`, `refund_receipt`, `payout_queued`, `payout_paid`, `statement_ready`.
- **Messaging:** `new_message_digest`, `deliverable_posted`, `review_reminder`.
- **Trust:** `idv_start`, `idv_reminder`, `bg_invited`, `badge_awarded`.
- **Promotions:** `promo_low_balance`, `promo_statement_ready`.

Each template includes:

- `variables_json` schema enumerating required variables (type, description, example).
- Accessibility checks (contrast ≥ 4.5:1, alt text, headless fallback).
- Localization coverage (initial `en-US`, `es-US`, `fr-CA` flagged for go-live).
- Experiment toggles (subject line variants, CTA wording, send time).

## Preferences & Quiet Hours Policy

- **Categories:** `security`, `legal`, `booking`, `messages`, `reviews`, `promotions`, `finance`.
- **Default Opt-In Matrix:**
  - Email: all except `promotions`.
  - Push: `booking`, `messages`, `reviews` post device consent.
  - SMS: opt-in required per category; only `security` enabled by default after consent.
  - In-app: always on.
- **Quiet Hours:** Default 21:00–08:00 local; per-category overrides allowed (`booking`). Router schedules send for `start_local + 1 minute` if non-critical.
- **Critical Overrides:** Security/legal/receipts bypass preferences when required; SMS fallback to email/in-app when consent missing.

## Deduplication & Batching Strategy

- **Dedup Keys:** e.g., `BOOKING:{lbg_id}:{status}`, `THREAD:{thread_id}:{minute}`.
- **Digest Cadence:** `messages.daily_digest`, `reviews.reminder`, `promo.weekly_summary`.
- **Batching Implementation:** Router collects events into DynamoDB `comms_digest` with aggregator Lambda executing on schedule to render summary template.
- **Idempotency:** All workers guard with idempotency key stored in DynamoDB `comms_idempotency`.

## Link Tracking & Privacy Controls

- Link wrapper tokens: `HMAC256(secret, user_id|template|msg_id|url)`.
- Tracking disabled for `security`, `legal`, `idv`, `bg_invited`.
- DNT header: Router marks message metadata; email templates include `<meta name="user-dnt" content="true">` when tracking disabled.
- UTM parameters limited to marketing templates; sanitized to avoid PII (only campaign, medium, template).
- SMS payloads direct to in-app deep link; shortened via CloudFront distribution with privacy-preserving tokens.

## Deliverability & Domain Authentication

- **Domains:** `notify.rastup.com` (transactional), `updates.rastup.com` (marketing). Distinct SES configuration sets.
- **SPF:** `v=spf1 include:amazonses.com -all`.
- **DKIM:** Easy DKIM with auto-rotation; calendar event ensures annual rotation.
- **DMARC:** `v=DMARC1; p=quarantine; pct=50; fo=1; rua=mailto:dmarc@rastup.com; ruf=mailto:dmarc@rastup.com` → escalate to `p=reject` post warmup.
- **Warmup Strategy:** 4-week ramp with daily send ladders; start with high-engagement templates (receipts). Dashboard monitors mailbox provider metrics.
- **BIMI:** Optional after DMARC reject; store VMC certificate in AWS Secrets Manager.

## Admin Console Requirements

- **Template Manager:** Version history, MJML preview, variable inspection, localization diff, staged rollout toggles, dual approval for `critical=true`.
- **Suppression Viewer:** Search by hashed email/phone, display reason, re-permission workflow requiring documented consent.
- **Campaign/Digest Config:** UI to schedule digests, manage experiments, configure send windows.
- **Audit Log:** Every admin action recorded in `comms_audit` with diff payload; surfaced in admin UI and exported to S3 nightly.
- **RBAC:** Amplify Admin UI roles `CommsEditor`, `CommsApprover`, `CommsViewer`.
- **Test Send:** Whitelisted addresses only; flagged as `cause_event='admin.test'` in `comms_message`.

## Observability, Metrics & Alerts

- **Metrics:** Delivery %, bounce %, complaint %, open/click (where enabled), unsubscribe rate, queue depth, send latency, SMS cost per 1k, push invalid token rate, digest suppression %, quiet hour deferrals.
- **Dashboards:** CloudWatch + Looker dashboards with per-channel widgets. Key SLOs:
  - Event→queued ≤ 150 ms p95.
  - Queue→provider ≤ 1 s p95.
  - Delivery rate ≥ 98.5% for transactional.
  - Complaint rate ≤ 0.1%, hard bounce ≤ 0.3% (7-day rolling).
  - In-app fetch latency ≤ 120 ms p95.
- **Alerts:** SES bounce spike, complaint spike, quiet-hours backlog, SMS spend anomaly, push invalid token surge, router error rate >1%.
- **Synthetic Tests:** Scheduled job sends probe messages per channel to sandbox recipients verifying end-to-end delivery and logs in `performance-security.txt`.

## Security & Compliance

- **PII Handling:** Templates avoid storing raw PII outside necessary channels; renders in S3 encrypted with KMS; access controlled by IAM roles.
- **Auditability:** All send decisions logged with reason (`preference`, `quiet hour`, `critical override`) and stored 400 days for compliance.
- **Regulatory:** CAN-SPAM (unsubscribe path), TCPA (SMS consent logging), GDPR (right to erasure triggers soft delete + anonymization).
- **Secrets Management:** Provider credentials stored in Secrets Manager with rotation; Twilio API keys, APNs certificates or tokens, Firebase server keys.
- **Penetration Testing:** Add to quarterly security program; ensure admin console passes OWASP ASVS checks.

## Testing & QA Matrix

- **Unit Tests:** Template variable coverage, router rule evaluation, dedupe functions, quiet hour scheduler, experiment bucketing.
- **Integration Tests:** Sandbox SES/Pinpoint sends via AWS simulation, Twilio test credentials, AppSync notifications, bounce→suppression flow.
- **Performance Tests:** Synthetic load via Step Functions generating 1k events/min; verify SLO compliance.
- **Compliance Tests:** Automated check verifying List-Unsubscribe headers, STOP/HELP presence, DMARC alignment.
- **Localization Tests:** Snapshot renders per locale; verify fallback path; RTL visual diff.
- **Admin QA:** Dual approval workflow simulation, audit log integrity, suppressed address re-permission fails without consent.

## Implementation Phases

1. **Foundations (Week 1)**
   - Provision Aurora schemas, DynamoDB tables, SQS queues, SNS topics.
   - Implement template catalog service and MJML compilation pipeline.
   - Stand up Comms Router with basic email + in-app delivery.
2. **Channel Expansion (Week 2)**
   - Add push (FCM/APNs) worker with token management.
   - Integrate SMS (SNS) with cost gating, STOP/HELP compliance.
   - Deliver in-app notification center API contract.
3. **Deliverability & Admin (Week 3)**
   - Configure SPF/DKIM/DMARC, bounce webhooks, suppression processor.
   - Build admin console (template management, suppression viewer).
   - Establish List-Unsubscribe endpoint and audit logging.
4. **Experiments, Localization, Telemetry (Week 4)**
   - Enable experimentation toggles, metric dashboards, guardrails.
   - Complete localization coverage, CLDR tests, quiet hour scheduling.
   - Finalize synthetic monitoring, runbooks, and attach pack automation.

## Risks & Mitigations

- **Deliverability Warmup Delays:** Mitigate via staged rollout, high engagement templates, monitoring.
- **Cost Overruns (SMS):** Enforce AppConfig gating, monthly budget alarms, digest fallback.
- **Localization Debt:** Set gating tests for locale coverage; fail CI when missing translations.
- **Admin Misconfiguration:** Dual approval and audit logs; limit destructive actions to `CommsApprover`.
- **Regulatory Breach:** Automated compliance tests; periodic legal review triggered by doc change.

## Open Questions

- Twilio adapter country list and pricing thresholds — pending finance input.
- Experiment analytics integration (Looker vs QuickSight) — align with analytics team.
- Dedicated IP acquisition timeline — requires volume forecast from marketing.
- In-app notification UI implementation timeline — coordinate with Agent A (web).

## Traceability

- **WBS Link:** WBS-015 (depends on WBS-001, WBS-002).
- **Blueprint Coverage:** Sections §1.10.A–§1.10.X mapped in sections above.
- **Artifacts:** Template catalog definitions, router design, admin requirements, testing matrix, implementation phases.
- **Next Steps:** Proceed with infrastructure implementation (SQS, Lambda, Aurora migrations), code scaffolding for router/workers, and admin UI build with Agents B–D.

