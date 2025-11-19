# Digest Fixtures

Synthetic payloads representing digests compiled by the Comms Router.

## File Types

- `messages_daily.json` — Example thread updates aggregated for daily digest.
- `reviews_reminder.json` — Reminder payload including booking metadata.
- `promo_weekly.json` — Weekly promotions digest with experiment variants.

Each fixture should include:

- `dedupe_key`
- `events` array with source event metadata
- `render_variables` block consumed by template renderer
- `expected_subject` for regression comparison

Use these fixtures with `tools/comms/digest_simulator.py` to validate output HTML/text.

