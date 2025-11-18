# Event Contract Registry (WBS-002)

Blueprint references: TD-0000, TD-0010, TD-0017, TD-0023, TD-0039, TD-0048.

## Design Principles

- Each event schema is a JSON Schema Draft-07 document with `privacy_tier`, `pii_fields`, and `retention_class` annotations baked into the schema metadata.
- Canonical naming follows `<domain>.<noun>.<verb>` and increments integer `version` when breaking changes ship.
- Schemas live in `docs/data/events/*.schema.json` and are registered through `schema_contract_registry`.
- CI gating runs `tools/validate_event_contracts.py` (TBD) and ensures manifests + checksums align with registry.
- Event payloads hash direct identifiers before emission whenever `privacy_tier` is `tier2` or `restricted`.

## Files Added This Run

- `user.account.created.v1.schema.json`
- `booking.leg.confirmed.v1.schema.json`
- `payment.refund.processed.v1.schema.json`
- `message.thread.posted.v1.schema.json`
- `manifest.json` enumerating event → file → checksum placeholder.

Future work: flesh out provider webhooks, admin actions, and data warehouse load specs.
