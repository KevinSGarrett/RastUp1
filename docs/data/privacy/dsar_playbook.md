# DSAR & Privacy Operations (WBS-002)

## Scope

- Applies to all personally identifiable data stored in Aurora (`app_user`, `service_profile`, messaging) plus downstream Bronze/Silver/Gold layers.
- Aligns with blueprint privacy requirements (TD-0000 §1.1.S, TD-0015 §1.3.N, TD-0044 §1.5.C).

## Request Lifecycle

1. **Intake**: User submits DSAR via account settings or support. Record row in `dsar_request` (`request_type` = `export` | `delete` | `rectify`).
2. **Verification**: Trust & Safety validates identity using recent login or government ID. Log verification document in `user_profile_document`.
3. **Scoping**: Populate `scope` JSON with dataset list (tables + event tiers) and time range. Default is full account history.
4. **Task Dispatch**:
   - Export → trigger Step Function `dsar-export` to package Bronze/Silver records plus static documents into encrypted S3 bundle.
   - Delete → enqueue `dsar-delete` workflow which calls domain services (messaging, bookings) followed by Bronze purge.
   - Rectify → create support ticket referencing DSAR row; domain owner applies corrections manually with audit trail.
5. **Audit & Completion**: Update `status` to `complete` and store `export_location` (pre-signed URL) or deletion proof hash. Insert entry into `pii_mask_audit` per table touched.

## Data Masking & Retention

- **Tier `restricted`**: Only stored hashed/tokenized; purge within 30 days when account closed.
- **Tier `tier2`**: Hash direct identifiers in Bronze, remove from Silver; Gold only exposes aggregated metrics ≥5 occurrences.
- **Tier `tier1`**: Pseudonymize email/phone; allow full access in Silver under role-based controls.
- **Public**: Non-sensitive metrics & catalog data; no DSAR action required.

Retention defaults:

| Dataset | Default Retention | Purge Trigger |
|---------|------------------|---------------|
| Messaging bodies | 3 years | DSAR delete, legal hold lift |
| Booking & payment | 7 years | Finance sign-off |
| Analytics Bronze | 400 days | Rolling purge job |
| Analytics Gold | Derived | Recomputed nightly, no raw PII |

## Controls & Monitoring

- Weekly job reconciles `dsar_request` rows vs S3 export buckets and deletion logs.
- PagerDuty alert if any DSAR > 25 days old without status `complete`.
- CI check ensures new tables declare `privacy_tier` & `retention_class` columns or metadata.

## Pending Follow-Ups

- Build scripted validation (`tools/audit_dsar_consistency.py`) to verify purge success across Aurora + S3.
- Document legal hold override workflow with compliance team.
