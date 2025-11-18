# PII Redaction & Minimization Policy

## Scope

Applies to application logs, analytics events, metrics labels, traces, and third-party integrations. Ensures compliance with GDPR, CCPA, and internal privacy standards.

## Do-Not-Log List

- Email addresses (mask username → `hash(email)`).
- Phone numbers (mask to `+1***1234`).
- Payment information (Stripe tokens only; never log PAN, expiry, CVC).
- Physical addresses, geo coordinates finer than city.
- OAuth and API tokens.
- Uploaded file names containing user-provided PII.

## Redaction Rules

| Data Type | Action | Notes |
| --- | --- | --- |
| IP address | Remove last octet; store full IP only in security logs with restricted access. |
| User agent | Allow but truncate to first 128 chars. |
| Free-form text (bio, messages) | Tokenize or redact before logging; rely on content moderation events instead. |
| Identifiers | Use UUIDs or hashed IDs (`SHA-256` with rotating salt). |
| Error payloads | Strip request/response bodies unless flagged non-sensitive. |

## Legal Hold & DSAR

- All deletion and legal hold actions captured in audit stream with `action`, `actor`, `ticket_id`.
- DSAR exports pull from redacted dataset; metadata stored for 30 days in `DSAR_EXPORT_BUCKET`.
- Legal hold requests freeze relevant S3 prefixes via Object Lock and update `LEGAL_HOLD_VAULT` manifest.

## Enforcement

- Static analysis (`tools/validate_log_fields.py`, TODO) scans code for disallowed logging patterns.
- CI secret scan (TruffleHog/Gitleaks) runs on every merge request.
- Runtime filters applied in Firehose transformation Lambda.

## Monitoring

- `pii_redaction_violations_total` counter increments when runtime filter redacts data; alerts at >0 per hour.
- `dsar_export_latency_seconds` tracked to guarantee completion in <5 minutes.

## Review Cadence

- Privacy counsel reviews policy quarterly or after major feature launches.
- Updates recorded in `docs/security/training_and_drills.md` and distributed during security training sessions.
