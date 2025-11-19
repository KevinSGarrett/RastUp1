# WBS-005 – Booking, Checkout, and Payment Processing Implementation Plan

## Context & Dependencies

- **WBS scope**: Implement booking lifecycles (Instant Book, Request-to-Book, Smart Invite), Linked Booking Group (LBG) checkout, docs-before-pay enforcement, Stripe Connect payments (card + ACH), refund kernel, disputes, and finance/admin surfaces.
- **Upstream WBS**: WBS-002 (core accounts, identities, Aurora baseline) and WBS-003 (search, availability discovery) provide prerequisite data and discovery flows.
- **Blueprint references**: TD-0007 – TD-0018, TD-0128 – TD-0146.
- **Assumptions**:
  - Aurora PostgreSQL remains system of record; DynamoDB only used for real-time contexts per §1.23.
  - Stripe Connect is the launch processor; adapters must isolate Stripe-specific fields.
  - DocuSign / Dropbox Sign integration handled via adapter contract defined here but implemented collaboratively with Integrations lane.

## Plan vs Done vs Pending (Pre-Run Summary)

- **Plan**
  - Author Aurora schema migration covering `lbg`, `booking_leg`, `charge`, `charge_split`, `deposit_auth`, `amendment`, `refund`, `dispute`, `payout`, `tax_txn`.
  - Define GraphQL schema (`api/schema/booking.graphql`) for checkout, amendments, completion, refunds, and disputes aligned with §1.3.I/§1.3.K/§1.3.L.
  - Implement backend domain modules (`services/booking/**`) capturing state machine, validation, payment orchestration hooks, and Stripe/tax/doc pack adapter interfaces.
  - Produce unit tests for state transitions, policy enforcement, and payments/refund calculations (Node TAP + Python for SQL schema validation).
  - Document operations/telemetry: draft runbook & event catalog updates where required.
  - Run smoke tests, document outcomes, assemble run report + attach pack.
- **Done**
  - Dependencies satisfied by prior WBS runs (WBS-002 accounts + WBS-003 search). No booking artifacts exist yet; this run starts greenfield.
- **Pending / Out of Scope for This Run**
  - Real Stripe/Tax provider provisioning & secrets.
  - Admin UI implementation and full Step Functions orchestration (requires cross-lane collaboration).
  - Full ACH settlement monitoring, payouts automation, and production infra.

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
