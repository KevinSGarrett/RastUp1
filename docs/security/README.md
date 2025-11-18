# Security, Privacy & Compliance Program

This directory consolidates controls required to satisfy WBS-021 acceptance criteria. It maps blueprint appendices to operational artefacts, covering IAM, encryption, WAF protection, audit logging, privacy workflows, incident response, PCI DSS posture, RBAC governance, and monitoring.

## Objectives

- Enforce least-privilege access with auditable key management.
- Protect public surfaces against automated abuse with WAF and rate limiting.
- Preserve tamper-evident audit logs and privacy-safe telemetry.
- Deliver privacy tooling for DSAR, legal hold, and redaction.
- Maintain compliance evidence for PCI DSS and quarterly security activities.
- Provide employees with just-in-time elevated access guarded by MFA.
- Integrate logging, monitoring, and alerting for rapid detection of threats.

## Artefact Index

| Control Area | Artefact |
| --- | --- |
| IAM & KMS | `docs/security/iam_and_kms.md`, `ops/config/registry.md`, `ops/runbooks/secret_rotation.md` |
| WAF & Abuse Mitigation | `docs/security/waf_bot_control.md`, `ops/config/flags.yaml` |
| Audit Logging | `docs/security/audit_logging.md`, `observability/log_schema.md`, `observability/redaction_policy.md` |
| Privacy & DSAR | `docs/security/privacy_operations.md`, `privacy/data_lifecycle.md` |
| PCI DSS | `docs/security/pci_dss.md` |
| RBAC & MFA | `docs/security/rbac_and_mfa.md` |
| Training & Drills | `docs/security/training_and_drills.md` |
| Incident Response | `ops/runbooks/incident_response.md` |

## Compliance Tracking

- Quarterly review security posture and update evidence repositories.
- Capture drill outcomes, pen test findings, and remediation plans in `docs/security/training_and_drills.md`.
- Reference `docs/runs/<date>-WBS-021-AGENT-1.md` for implementation narrative and testing evidence.
