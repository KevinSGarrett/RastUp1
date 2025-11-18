# Data Lifecycle & Retention

## Overview

Defines how user, provider, and operational data progresses from ingestion to archival and deletion. Aligns with Appendix O data governance requirements.

## Lifecycle Stages

1. **Collection:** Data captured through application forms, messaging, payments, and telemetry. Validation ensures only required attributes collected.
2. **Processing:** Data used for profile search, booking workflows, messaging, and analytics. Processing governed by RBAC policies in `docs/security/rbac_and_mfa.md`.
3. **Storage:** Primary stores include Aurora PostgreSQL, DynamoDB (rate limits), Typesense, S3 (media & exports), and analytics warehouse.
4. **Archival:** Nightly jobs copy immutable events to Glacier with retention markers.
5. **Deletion/Anonymization:** Triggered by DSAR, retention schedules, or legal requests. Implemented via stored procedures and Glue jobs.

## Retention Matrix (excerpt)

| Dataset | Retention | Action | Notes |
| --- | --- | --- | --- |
| `users` | Account lifetime + 30 days | Anonymize | Retain hashed identifiers for abuse prevention. |
| `profiles` | Account lifetime + 90 days | Anonymize | Maintains marketplace integrity while allowing dispute resolution. |
| `messages` | 18 months | Delete | Hard delete message body, retain metadata (sender, timestamps) for fraud analysis. |
| `bookings` | 7 years | Archive | Required for financial reconciliation; anonymize user details after 24 months. |
| `payments` | 7 years | Retain | Tokenized; required for PCI evidence; sensitive data stored in Stripe only. |
| `audit_logs` | 1 year hot, 7 years cold | Retain | Immutable WORM storage with chain hashing. |
| `dsar_exports` | 30 days | Delete | Auto purge via lifecycle policy. |

## Automation

- Glue workflow `privacy-retention-workflow` enforces table-level TTL rules with success metrics stored in CloudWatch.
- Lambda trigger monitors S3 lifecycle completion and writes summary to audit log.
- Typesense index purge script ensures search removal within 5 minutes.

## Compliance

- Review retention schedule annually with legal.
- Document exceptions (e.g., ongoing investigations) in `docs/security/privacy_operations.md`.
- Monitor for retention drift using `tests/security/test_data_retention.py` (added).
