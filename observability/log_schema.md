# Security Log Schema & Pipeline

## Purpose

Defines fields, formats, and processing rules for application, infrastructure, and security telemetry. Aligns with Appendix M and supports immutable audit logging requirements.

## JSON Event Schema

```json
{
  "ts": "2025-11-06T12:34:56.789Z",
  "sev": "INFO",
  "svc": "search-api",
  "component": "graphql",
  "req_id": "r-abc123",
  "session_id": "s-def456",
  "user_id": "u_123",
  "route": "/search/people",
  "lat_ms": 132,
  "remote_ip": "REDACTED",
  "msg": "search ok",
  "extra": {
    "city": "LA",
    "role": "photographer",
    "cache": "hit"
  }
}
```

- **Required fields:** `ts`, `sev`, `svc`, `req_id`, `msg`.
- **Severity enumeration:** `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`.
- **Correlation:** `req_id` propagates across services; `session_id` aligns with analytics events; `component` tags sub-systems.
- **Sampling:** `WARN`+ always emitted; `INFO` sampled 10–20% on hot paths, 100% during incidents (toggle via `log-sample-rate` dynamic config).
- **PII Restrictions:** Emails, full IPs, phone numbers, payment data, and OAuth tokens must be removed or hashed before emission; see `redaction_policy.md`. `user_id` and `session_id` values are hashed when forwarded to analytics streams.

## Transport & Storage

- Logs flow to CloudWatch → Kinesis Firehose (with record mutation) → S3 bucket `AUDIT_LOG_BUCKET`.
- Firehose Lambda enriches events with `trace_id` and enforces schema shape.
- S3 bucket enforces Object Lock (governance mode) with 1-year retention and daily Glacier archive.
- CloudTrail, Config, GuardDuty, and Security Hub findings are normalized into the same schema.

## Integrity Controls

- Each batch file includes:
  - `sha256` hash of file contents.
  - Chain hash seeded by `AUDIT_LOG_CHAIN_SALT`; stored alongside manifest in `/manifests/<date>.json`.
- Hash validation job (`tools/validate_audit_chain.py`, TODO) runs hourly; failures raise SEV2 incident.

## Access Control

- Access granted via `SecurityAudit` IAM role with MFA.
- Read requests logged and forwarded to audit stream.
- Legal hold requests clone objects into `LEGAL_HOLD_VAULT` bucket with WORM retention.

## Metrics & Alerts

- `log_ingest_latency_seconds` histogram target < 60s p95.
- `log_sample_rate_percent` gauge ensures sampling adjustments recorded.
- Alerts when:
  - `ERROR` rate > baseline + 3σ.
  - Missing logs for critical service > 5 minutes.

## Evidence Collection

- Quarterly export of schema and sampling configuration attached to SOC2 evidence folder.
- CI check verifies that `observability/log_schema.md` JSON example parses and required fields present.
