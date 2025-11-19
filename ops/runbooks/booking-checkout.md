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
1. Finance triages evidence (photos, doc pack, chat) and confirms claim within policy window. Query `booking.deposit_claim` for prior submissions.
2. File `fileDepositClaim` mutation (finance role) with evidence URLs and reason; confirm new `PENDING` row in `booking.deposit_claim`.
3. Approve partial/full capture via `approveDepositClaim` (include `idempotencyKey` + `decisionReason`). Use `denyDepositClaim` or `voidDepositClaim` when evidence insufficient or claim withdrawn.
4. Confirm `booking.deposit_auth.captured_cents` updated and `DepositSummary` shows new `claimWindowExpiresAt`. Monitor immutable events `deposit.claim.approved|denied|voided`.
5. Receipts regenerate automatically; validate `booking.receipt_manifest` contains fresh leg + group manifests referencing the capture/decision.

### 7. Acceptance Window & Receipts
1. When acceptance window expires without buyer action, scheduler triggers `canAutoComplete` → `markCompleted`. Check `booking.lbg.acceptance_until` and event `acceptance.auto_accept`.
2. Receipt rendering failures land in `receipt.render.error` log. Re-run generator and verify records in `booking.receipt_manifest` have `storage_url` populated.
3. To resend receipts, fetch manifest payload, regenerate PDF, and upload to S3 (path: `s3://receipts/<receiptId>.pdf`). Update storage pointer for audit.

### 8. Webhook Replay & Idempotency
1. Inspect `booking.webhook_event` for missing/failed events (each row keyed by provider + event id). Any duplicates indicate idempotency guard engaged.
2. For Stripe: replay via dashboard or CLI with same event id; ensure deduper (`createWebhookDeduper`) permits processing only once.
3. For tax/doc providers, verify normalized events `tax.*` / `doc.envelope.*` emitted downstream; stale rows older than 48h without `processed_at` require manual replay.

### 9. Step Functions Saga Recovery
1. Identify saga executions stalled in `QueuePayouts` or `DisputeGate` within AWS Step Functions console (`BookingCheckoutSaga`).
2. Verify related idempotency keys in `booking.idempotency_record`; clear only if execution has been safely rolled back.
3. Use `runSaga` tooling to re-drive execution with `reconcile=true`, ensuring handlers are idempotent (payment confirms, payout queue, completion).
4. For repeated failures emit `booking.saga.failed` event and pause new confirmations via feature flag.

### 10. Payout Queue & Reserves
1. Review `booking.payout` table for statuses `failed` or `paused`. Retry via finance console or `queuePayouts` mutation with fresh idempotency key.
2. Inspect `booking.reserve_ledger` for entries stuck in `held` beyond policy window; use `releaseReserveHold` mutation with reason and dual approval.
3. Instant payouts: if `instantPayoutEligible=true` but transfers fail, verify seller risk/rsv policy and re-run with standard schedule.
4. ACH settlements pending: ensure payouts respect hold window (configurable) before releasing.

### 11. Finance Daily Close
1. Launch close via `startFinanceDailyClose` mutation (requires idempotency key) selecting prior business day.
2. Monitor `booking.finance_daily_close` status (`in_progress`→`succeeded`). Variances materialised in `booking.finance_daily_close_item`.
3. If `varianceBps` exceeds tolerance (0.5%), payouts remain paused—resolve outstanding items, adjust ledger, then rerun close.
4. Archive close artifacts to finance data room and log completion in `finance.close` channel.

### 12. Dispute Evidence Workflow
1. Upon `charge.dispute.created`, confirm `booking.dispute` row exists and payout is paused.
2. Collect documents (doc packs, receipts, chat, photos) and assemble kit via `submitDisputeEvidence` mutation; ensure narrative covers policy compliance.
3. Track evidence deadline (`evidence_due_at`) and update status changes from Stripe webhooks (`charge.dispute.closed`).
4. Lost dispute? Apply reserve forfeiture using automation; won dispute? release reserve entry and resume payouts.

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
- Receipts & claims: `booking.deposit_claim`, `booking.receipt_manifest`, `booking.webhook_event`
