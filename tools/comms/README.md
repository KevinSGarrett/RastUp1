# Communications Tooling

Utility scripts and automation supporting the WBS-015 communications stack.

## Planned Utilities

- `render_templates.py` — Compile MJML templates, validate variable bindings, produce HTML snapshots for QA.
- `preflight.py` — Verify provider credentials (SES, FCM, APNs, Twilio), AppConfig flags, suppression list sync status.
- `digest_simulator.py` — Generate digest summaries from seed fixtures to test batching logic.
- `audit_export.py` — Export `comms_audit` records with filters for compliance reviews.

## Contribution Guidelines

- Scripts must be idempotent and safe against production data; default to dry-run unless `--apply` provided.
- Include unit tests under `tests/python` or `tests/tools` validating critical logic.
- Document required environment variables and AWS permissions within each script.
- Respect Safe Writes policy; ensure artifacts land inside repo-approved directories (e.g., `docs/data/comms` for reference outputs).

