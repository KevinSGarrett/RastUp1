# Booking Checkout & Payments Runbook (WBS-005)

## Purpose

Provide operational guidance for the Linked Booking Group (LBG) checkout pipeline, including docs-before-pay enforcement, payment capture, deposits, refunds, and reconciliation guards. This runbook targets on-call engineers and finance ops responding to incidents in production.

## System Overview

- **State Machine**: Legs transition `DRAFT → AWAITING_DOCS → AWAITING_PAYMENT → CONFIRMED → IN_PROGRESS → COMPLETED`. LBG status derives from leg states.
- **Docs-before-pay**: Smart Docs envelope must be fully signed before payment intent confirmation.
- **Charges**: Single LBG-level PaymentIntent with per-leg splits; incremental capture supported for card deltas.
- **Deposits**: Studio legs may authorize SetupIntent holds; capture only after approved claim.
- **Refund Kernel**: Time-banded policy engine per leg; overrides require dual approval (finance + trust).
- **Telemetry**: Immutable events `booking.checkout.*`, `payment.charge.*`, `refund.processed`, `deposit.capture`.

## Steady-State Expectations

- p95 checkout confirmation latency < 2.5s.
- Charge success rate ≥ 96% (cards) / 90% (ACH).
- Webhook DLQ empty; idempotency store growth < 5% daily.
- Payout scheduler backlog < 50 items; reserve queue drained within SLA.

## Runbook Actions

### 1. Checkout Failure (Docs Not Signed)
1. Inspect `booking.checkout.blocked` event for `missing_docs`.
2. Ensure both legs report `docsSigned: true` via `booking` query.
3. If Smart Docs outage, enable `checkout.docs_override` feature flag (finance approval required) and log incident.

### 2. PaymentIntent Declines
1. Check Stripe dashboard for decline code.
2. Validate `ensureAtomicConfirmation` logs for leg readiness.
3. Retry `createPaymentIntent` with alternate method. For repeated 3DS failures, toggle `payment.force_3ds` flag off only with risk approval.
4. Capture Stripe diagnostic `pi_xxx` and attach to incident ticket.

### 3. Incremental Capture for Amendments
1. Determine delta total vs remaining authorized amount.
2. If `shouldUseIncrementalCapture` returns false, create secondary PaymentIntent and link to amendment ID.
3. Update charge ledger via `booking.charge_split` entries.

### 4. ACH Settlement Risk
1. Monitor `payment.charge.ach.settlement_pending` metrics.
2. Hold payouts until event `ach.settlement_confirmed` or 5 business days elapsed.
3. Escalate to finance if pending > 5 days to initiate manual trace.

### 5. Refund Discrepancies
1. Use `quoteCancellation` to recompute expected refund.
2. Compare with `booking.refund` table entries.
3. If mismatch, trigger replay of Stripe refund webhook (`payment.refund.replay`) and notify finance ops.

### 6. Deposit Claims
1. Finance reviews evidence pack; approve in admin console.
2. Invoke `fileDepositClaim` mutation (finance role) with evidence URL.
3. Verify `booking.deposit_auth` updated to `CAPTURED` and `deposit.capture.succeeded` event emitted.

## Verification & Observability

- Dashboards: see `observability/dashboards/booking.md`.
- Alerts:
  - `checkout-latency-slo` critical if > 5 min.
  - `stripe-webhook-dlq` warning at > 5 messages, critical > 20.
  - `refund-mismatch` triggers when ledger variance > $50.

## Backfill / Replay Procedures

1. Pause payout scheduler (`PAYROLL_PAUSE` flag).
2. Re-run LBG saga Step Function with `reconcile=true`.
3. Reconcile differences using finance close procedure (§1.3.V).

## Escalation Matrix

- **Stripe incidents**: Integration on-call + finance lead.
- **DocuSign/Dropbox Sign**: Integrations team after verifying pack status.
- **Tax Provider**: Tax ops if quote commit fails twice (auto DLQ escalation).
- **Disputes surge**: Trust & Safety, finance, legal triage.

## References

- Schema: `db/migrations/026_booking_core.sql`
- Domain logic: `services/booking/*.js`
- Policies: `docs/data/booking/implementation_plan.md`
- Attach pack manifest: `docs/orchestrator/from-agents/AGENT-2/*`
