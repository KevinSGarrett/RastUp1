# WBS-005 – Booking, Checkout, and Payment Processing Implementation Plan

## Context & Dependencies

- **WBS scope**: Implement booking lifecycles (Instant Book, Request-to-Book, Smart Invite), Linked Booking Group (LBG) checkout, docs-before-pay enforcement, Stripe Connect payments (card + ACH), refund kernel, disputes, and finance/admin surfaces.
- **Upstream WBS**: WBS-002 (core accounts, identities, Aurora baseline) and WBS-003 (search, availability discovery) provide prerequisite data and discovery flows.
- **Blueprint references**: TD-0007 – TD-0018, TD-0128 – TD-0146.
- **Assumptions**:
  - Aurora PostgreSQL remains system of record; DynamoDB only used for real-time contexts per §1.23.
  - Stripe Connect is the launch processor; adapters must isolate Stripe-specific fields.
  - DocuSign / Dropbox Sign integration handled via adapter contract defined here but implemented collaboratively with Integrations lane.

## Plan vs Done vs Pending (2025-11-19 Run — Part 3 Focus)

- **Plan**
  - Extend booking core schema with reserve ledgers, finance daily close, and idempotency record tables.
  - Deliver Part-3 domain modules: Step Functions saga orchestration, payout/reserve computations, dispute evidence handling, finance reconciliation, and idempotency helpers.
  - Expand GraphQL contract for finance ops (reserve policies, payout queue, daily close) and trust tooling (dispute evidence submission).
  - Add Node unit tests for saga/idempotency/payout/dispute/reconciliation flows plus refresh Python schema validation.
  - Update documentation (implementation plan, runbook, observability) and execute required test commands (`node --test`, `python -m unittest`, `make ci`).
- **Done**
  - Part-1 artefacts (schema baseline, GraphQL contract, state/policy/payment modules) and Part-2 deliverables (amendments, cancellations, deposits, receipts, webhooks) completed in prior runs.
- **Pending / Out of Scope for This Run**
  - Real Stripe/Tax/Doc Pack integrations, secrets management, and infra provisioning.
  - Admin UI wiring for finance/trust consoles and production deployment of saga orchestrator.
  - Automated CI/Makefile bootstrap and end-to-end integration environments.

## Declared Scope Paths (anticipated)

- `docs/data/booking/**`
- `db/migrations/026_booking_core.sql`
- `api/schema/booking.graphql`
- `services/booking/**`
- `services/payments/**` *(new adapters if needed)*
- `tests/booking/**`
- `tests/payments/**`
- `tests/python/test_booking_*`
- `docs/runs/**`, `docs/PROGRESS.md`
- `ops/runbooks/booking-checkout.md`
- `observability/dashboards/booking.md`

## Implementation Strategy

1. **Data Model**
   - Translate blueprint tables into normalized Aurora migration with indexes, constraints, triggers for optimistic locking & updated timestamps.
   - Introduce check constraints for enums (statuses, types) and guard rails for monetary integrity (e.g., `amount_cents > 0`).
   - Prepare views/materialized views (or at least comments) for reconciliation queries.
2. **Domain Modules**
   - Build TypeScript domain library with:
     - `stateMachine` for leg/LBG transitions and guards (docs-before-pay, atomic confirm).
     - `charges` orchestrator hooking into payment adapter interface.
     - `refunds` policy engine translating time-banded policies into amounts.
     - `deposits` workflow for setup intent and capture pipeline.
   - Provide environment-agnostic adapter contracts (`StripePaymentAdapter`, `TaxAdapter`, `DocPackAdapter`) with stub implementations throwing `NotImplementedError` for now.
   - Export pure functions for pricing, policy evaluation, and doc gating to enable deterministic tests.
3. **GraphQL Contract**
   - Mutations & queries mirroring state machine operations with idempotency token and error taxonomy usage.
   - Input types capturing policy parameters, extras, overtime, and refunds per leg.
4. **Testing**
   - Node-based tests verifying state machine transitions, atomic LBG confirm behavior, refund kernel decision matrix, and deposit claim flow.
   - Python tests ensuring migration integrity (enum values, foreign keys) and JSON schema for events if added.
5. **Operational Docs**
   - Create runbook summarizing checkout steps, failure modes, Stripe reconciliation tasks.
   - Draft observability dashboard spec enumerating key metrics (checkout latency, charge success, payout lag).

## Testing Strategy

- `node --test tests/booking/*.test.mjs` for state machine & pricing logic.
- `python -m unittest tests.booking.test_schema` for migration validation and invariants.
- `make ci` (expected to fail until CI scaffold exists) — capture output for transparency.

## Open Issues & Risks

- Need coordination with Integrations lane for live Stripe/Avalara/DocuSign adapters; current run will ship interfaces and mocks.
- ACH settlement risk: require holdback/reserve configuration; note as follow-up for payouts-focused run.
- Step Functions saga not delivered here; must highlight as dependency for future automation.
