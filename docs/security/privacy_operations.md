# Privacy Operations & DSAR Workflow

## Principles

- Collect minimum PII required for marketplace operations.
- Honor user access, export, and deletion requests within GDPR/CCPA SLAs.
- Preserve evidence of compliance without retaining unnecessary personal data.

## Data Minimization

- Default to pseudonymous identifiers in analytics (`user_id_hash`).
- Optional profile fields (phone, socials) disabled for minors and hidden until verification.
- Media uploads processed to remove EXIF metadata; NSFW variants stored in separate S3 bucket with tighter ACLs.
- Search index stores only required facets (city, role, rating) and hashed identifiers.

## DSAR Workflow

1. **Intake:** Trust & Safety portal or email `privacy@rastup.com`; ticket created with SLA timer.
2. **Verification:** Identity verified via login session or signed attestation for non-users.
3. **Export:**
   - Trigger `services/dsar/propagate.ts` job.
   - Compile data from Aurora, Typesense, S3 media metadata, audit logs.
   - Package into encrypted ZIP stored in `DSAR_EXPORT_BUCKET` (30-day lifecycle).
   - Sign manifest using `DSAR_SIGNING_KEY_ARN`.
4. **Deletion:**
   - Cascade anonymization across Aurora (`users`, `profiles`, `messages`), Typesense, analytics warehouse.
   - Search index purge must complete \< 5 minutes (monitor `dsar_purge_latency_seconds`).
   - Mark entries in audit log with hash reference.
5. **Confirmation:** Notify requester with signed manifest link; record completion timestamp.

## Legal Holds

- Legal team can place hold by specifying user ID hashes or order IDs.
- Automation tags relevant S3/Aurora records with `legal_hold=true` preventing deletion.
- Holds recorded in audit log; release requires dual approval (legal + security).

## Redaction

- Logging policies defined in `observability/redaction_policy.md`.
- Data warehouse views exclude direct identifiers; BI dashboards use aggregated metrics.
- Support tooling includes inline redaction for customer support transcripts.

## Training & Awareness

- Quarterly privacy training covering DSAR handling and breach notification.
- DSAR dry runs executed twice per year; most recent completion (Q4 2025 dry run) finished in **3m45s** and is logged in `docs/security/training_and_drills.md`.

## Evidence

- Maintain checklist for each DSAR in `docs/security/privacy_operations.md#dsar-log`.
- Store signed manifests and export packages in audit bucket (Object Lock 30 days).

## DSAR Log Template

| Ticket | Request Type | Received | Completed | SLA Met | Notes |
| --- | --- | --- | --- | --- | --- |
| `DSAR-2025-001` | Access + Deletion | 2025-01-04 | 2025-01-08 | ✅ | Stage dry-run with synthetic user. |
