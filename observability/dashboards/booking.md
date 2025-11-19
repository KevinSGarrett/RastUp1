# Booking & Payments Observability Specification

## Dashboard: `Booking / Checkout Overview`

- **Checkout Funnel**
  - `booking.checkout.started` vs `booking.checkout.confirmed` (stacked by mode: IB, RTB, Smart Invite).
  - Drop-off chart by stage (`awaiting_docs`, `awaiting_payment`, `confirmed`).
- **Latency**
  - p50/p95 for `startCheckout → confirmPayment`.
  - Docs-before-pay latency (`createDocPack → markDocSigned`).
  - Stripe PaymentIntent confirmation latency.
- **Error Budget**
  - Error rate by taxonomy codes (`DOCS_NOT_SIGNED`, `CHARGE_NOT_READY`, `AMENDMENT_PAYMENT_FAILED`).
  - Alert when error rate > 4% over 5 min.
- **Idempotency**
  - Count of idempotent replays (Stripe PI, refunds) vs new requests.
  - Dedup store depth (records > 24h).

## Dashboard: `Finance Ops & Reconciliation`

- **Charges & Refunds**
  - Daily GMV vs captured amount vs pending refunds.
  - ACH settlement aging buckets.
  - Refund processing time (init → succeeded).
- **Payout Pipeline**
  - Items queued by reserve status (normal, reserve, paused).
  - Transfer success vs failure (grouped by Stripe Connect response).
- **Deposits**
  - Authorized vs captured vs expired SetupIntents.
  - Claims approved/denied with average capture amount.
- **Variance Checks**
  - Booking ledger vs payment ledger delta (USD).
  - Tax commitment mismatches (per provider).

## Dashboard: `Trust & Dispute Operations`

- **Disputes**
  - Volume by status (`NEEDS_RESPONSE`, `UNDER_REVIEW`, `WON`, `LOST`).
  - Chargeback ratio vs processor threshold.
- **Evidence SLA**
  - Time to assemble evidence kit.
  - Doc pack retrieval failures.
- **Policy Overrides**
  - Count of admin overrides (cancellation refunds, deposit captures).
  - Override reasons and approving admin.

## Key Metrics & Alerts

- `booking.checkout.latency.p95` > 2.5s → page engineer.
- `payment.intent.failure_rate` > 8% per 10 min window.
- `stripe.webhook.dlq.depth` > 10 events sustained for 5 min.
- `refund.outcome.mismatch` any variance > $50 triggered.
- `payout.reserve.backlog` > 100 leads to finance escalation.

## Logging & Tracing

- Correlation via `checkout_session_id` and `charge_id` spans.
- Structured logs must include `lbg_id`, `leg_id`, `mode`, `city`.
- Traces instrumented on Step Functions saga and Lambda handlers:
  - `checkout.start`
  - `docs.envelope.create` / `docs.envelope.signed`
  - `stripe.payment_intent.confirm`
  - `refund.kernel.evaluate`

## Data Sources

- Aurora read replicas: `booking.*` tables.
- Event bridge stream: `payment.*`, `booking.*`.
- Stripe telemetry via Stripe Data Pipeline (Snowflake).
- Tax provider logs via Kinesis Firehose (`tax_txn`).

## Ownership & Links

- Dashboard owner: Finance Platform Team (AGENT-2).
- Slack alerts: `#alerts-booking-payments`.
- Runbook: `ops/runbooks/booking-checkout.md`.
- Test plan references: `tests/booking/*.test.mjs`, `tests/python/test_booking_schema.py`.
