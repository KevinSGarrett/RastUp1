# RBAC, Just-In-Time Access & MFA

## Role Model

- **User Groups:**
  - `staff-readonly`: Support and analytics read access (no production write).
  - `staff-ops`: Limited administrative actions (content moderation, refund approvals).
  - `staff-privileged`: Platform engineers requiring infrastructure changes; must request JIT elevation.
  - `contractor`: Time-boxed access; restricted to dev/stage.

- **Service Accounts:**
  - Managed via IAM roles; no long-lived user credentials permitted.

## Just-In-Time Elevation

- Access requests submitted via Access Manager workflow with ticket reference.
- Upon approval, system issues temporary credential (max 1 hour) by assuming `RBAC_JIT_ROLE_ARN`.
- Full session recorded (AWS CloudTrail + session recording proxy).
- Post session:
  - Evaluate actions for adherence to change policy.
  - Upload summary to audit log with `action=jit_elevation`.

## Multi-Factor Authentication

- Hardware security keys (WebAuthn/U2F) required for all privileged groups.
- Backup codes stored in sealed envelope with security team; rotated semi-annually.
- Enforced at SSO provider and AWS IAM Identity Center; login attempts without MFA blocked.

## Joiner / Mover / Leaver

- `docs/security/training_and_drills.md` tracks onboarding/offboarding checklist completion.
- Automation ensures:
  - Leaver access revoked within 4 hours of termination request.
  - Movers undergo access review to remove obsolete privileges.
- Quarterly access reviews ensure least privilege maintained.

## Monitoring & Alerts

- CloudWatch metric `jit_sessions_active` ensures max concurrent sessions < 3.
- Security Hub custom rule flags IAM user creation or policy attachment outside provisioning pipeline.
- PagerDuty alert triggered if privileged account login without MFA detected (should be impossible).

## Evidence

- Quarterly RBAC matrix exported to `security/iam_matrix.csv` (TODO).
- JIT session transcripts stored in `LEGAL_HOLD_VAULT` for 1 year.
- Training logs demonstrate MFA usage compliance.
