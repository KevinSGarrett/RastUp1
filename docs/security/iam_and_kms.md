# IAM & KMS Controls

## Objectives

- Guarantee least-privilege access for services and humans.
- Enforce envelope encryption for secrets, audit logs, and DSAR exports.
- Provide documented rotation, monitoring, and evidence collection.

## IAM Architecture

- **Federation:** Workforce authenticates via SSO (Okta/Azure AD) → AWS IAM Identity Center; Admin access requires hardware MFA.
- **Role taxonomy:**
  - `AppServiceRole`: runtime principal for API & queue workers with read-only access to parameterized secrets and KMS decrypt rights scoped to `condition: {"kms:EncryptionContext:svc": "app"}`.
  - `IndexerRole`: Typesense indexer permissions to S3 staging, read-only Aurora replica, and `kms:Decrypt` limited to `search` context.
  - `SecurityAuditRole`: read-only access to CloudTrail, Config, GuardDuty, and audit S3 bucket.
  - `AccessManagerRole`: human-only, time-limited role for JIT elevation (see `docs/security/rbac_and_mfa.md`).
- **Policy hygiene:**
  - Deny `iam:*` except via provisioning pipeline.
  - SCP blocks root API keys.
  - Tag-based access (`Environment`, `Owner`, `Confidentiality`) to enforce segregation.

## Key Management

- **Customer-managed keys:**
  - `alias/app-primary`: Data encryption key for application secrets and DSAR exports.
  - `alias/audit-log`: Dedicated to immutable audit log bucket with strict key policies.
  - `alias/dsar-signing`: Signs DSAR manifests and deletion confirmations.
- Keys stored in AWS KMS with automatic rotation disabled; manual rotation performed via `ops/runbooks/secret_rotation.md` to ensure evidence capture.
- Encryption context includes `svc`, `env`, and `classification` fields to prevent cross-service misuse.

## Secrets Lifecycle

- All secrets defined in `ops/config/registry.md`.
- Retrieval occurs at runtime via AWS SDK; credentials not baked into images.
- `global-readonly` flag enforced before large rotations to prevent data inconsistency.
- `tools/secrets/check_unused.py` (TODO) scans for stale keys and alerts weekly.

## Monitoring & Alerts

- CloudWatch Alarm: `KMSKeyUsage` anomaly detection for each customer key.
- GuardDuty + Security Hub aggregated into `observability/log_schema.md` pipeline.
- AWS Config rules ensure:
  - No IAM user without MFA.
  - No access keys older than 90 days.
  - Secret Manager rotation metadata aligns with expected interval.

## Evidence & Auditing

- Quarterly SOC2 evidence:
  - IAM role review exported from IAM Identity Center.
  - KMS policy diff captured via `aws kms get-key-policy`.
  - Secrets Manager rotation reports attached to `docs/security/training_and_drills.md`.
- All `iam:CreateRole`, `iam:AttachRolePolicy`, `kms:CreateKey`, and `secretsmanager:PutSecretValue` events mirrored to immutable audit log chain.
