# Communications Data Assets

This directory stores supporting artifacts for the communications and notifications system (WBS-015).

## Structure

- `templates/` — MJML source, localized copies, compiled HTML snapshots for QA.
- `provider_samples.json` — Canonical webhook payloads (SES, Pinpoint, Twilio) used in integration tests.
- `seed_preferences.csv` — Synthetic user preferences and quiet hours for local/test environments.
- `digest_fixtures/` — Example digest payloads validating batching logic.

## Usage Guidelines

- Files under this directory are treated as reference data; do not include production secrets or real user PII.
- Update fixtures alongside code changes affecting template variables, webhook schemas, or routing logic.
- Ensure localized templates are reviewed by native speakers before promotion; include review metadata in file headers.
- Regenerate compiled HTML snapshots after modifying MJML by running `tools/comms/render_templates.py` (to be implemented).

