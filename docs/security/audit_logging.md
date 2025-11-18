# Immutable Audit Logging

## Goals

- Capture all privileged actions, authentication events, data access, and lifecycle operations.
- Provide tamper-evident storage with cryptographic chain hashes and WORM retention.
- Support investigations, DSAR legal holds, and compliance attestation.

## Scope of Events

- Authentication: login, MFA challenge, session revocation.
- Authorization: RBAC elevation requests, Access Manager approvals.
- Secrets & keys: creation, rotation, deletion.
- Data lifecycle: DSAR export/deletion, legal hold changes, PII redaction overrides.
- Payments: Stripe Connect onboarding, payout destination changes.
- Infrastructure: deployments, config changes, WAF rule updates, security group changes.

## Pipeline

1. Producers emit JSON records conforming to `observability/log_schema.md` with `category=audit`.
2. Events enter Kinesis Firehose → Lambda transformer:
   - Adds chain hash field `chain_sha256`.
   - Validates required attributes (`actor`, `action`, `target`, `result`).
3. Firehose writes to S3 bucket `AUDIT_LOG_BUCKET` with:
   - Versioning enabled.
   - Object Lock (governance mode) for 1 year + optional 7-year legal hold.
   - SSE-KMS using `KMS_KEY_AUDIT_LOG`.
4. Daily job writes manifest file:
   ```json
   {
     "date": "2025-11-18",
     "records": 12345,
     "file_hash": "abc...",
     "chain_hash": "def..."
   }
   ```
5. Manifest stored in `s3://AUDIT_LOG_BUCKET/manifests/<date>.json` and mirrored to `LEGAL_HOLD_VAULT`.

## Chain Hashing

- Each event includes `prev_hash` referencing prior event hash (ordered by ingestion timestamp).
- Initial seed stored in Secrets Manager (`AUDIT_LOG_CHAIN_SALT`).
- Validation job compares recalculated chain; on mismatch raises SEV3 incident.

## Access & Queries

- Read access limited to `SecurityAuditRole` with MFA.
- Analysts use Athena with workgroup-level query logging.
- DSAR tooling (`services/dsar/propagate.ts` placeholder) queries audit events to verify completion.

## Integration Points

- Incident response uses audit logs to confirm actions during SEV events.
- PCI DSS requirement 10 satisfied via this pipeline; evidence archived quarterly.
- Logs feed Splunk/ELK for correlation with GuardDuty findings.

## Tests & Automation

- `tests/security/test_audit_chain.py` (added) validates JSON schema and chain hash continuity on sample dataset.
- CI ensures `observability/log_schema.md` example is valid JSON and contains required fields.

## Retention & Deletion

- Hot storage (S3) retained 90 days for quick access.
- Glacier Deep Archive copy retained 7 years.
- DSAR deletions do **not** remove entries; they log anonymization event referencing subject ID hash.
