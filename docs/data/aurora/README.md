# Core Aurora Data Model (WBS-002)

This module captures the canonical relational structures for the marketplace platform. It is derived directly from blueprint sections TD-0000 through TD-0059 and implements the minimum viable slice of:

- foundational identity and compliance (`app_user`, `user_profile_document`)
- supply catalog (`service_profile`, `studio`, `studio_service_profile`)
- commerce execution (`booking`, `booking_leg`, `payment_intent`, `payment_transaction`)
- communications & reputation (`message_*`, `review`)
- growth & policy enforcement (`promotion`, `trust_case`, `support_ticket`)
- analytics privacy tiers + lineage (`analytics_event_*`, `schema_contract_*`, `lineage_edge`, `pii_mask_audit`, `dsar_request`)

## Guiding Constraints

- Pure PostgreSQL DDL, Aurora-compatible, generated 2025-11-18 by AGENT-1.
- Strict `on delete cascade/restrict` choices to mirror blueprint invariants for data retention and Safe-Mode.
- JSON validation enforced through lightweight CHECK constraints (type checks, array bounds for `languages`, `tags`, etc.).
- Booking legs maintain uniqueness per service profile and enforce `end_at > start_at` to satisfy conflict policy.
- Event pipeline tiers (`bronze → silver → gold`) separated to support quality checks and privacy masking.
- Schema contracts tracked via registry tables with CI gate logging for enforcement.

See `core_schema.sql` in the same directory for the full DDL. Use migrations derived from that file when standing up Aurora environments. A companion lineage map update is expected before production launch.
