# Security Training, Scans & Drills

## Programs

- **Annual Security Training:** Mandatory for all employees; covers phishing awareness, secure coding, privacy obligations, and incident reporting channels.
- **Quarterly Privacy Workshop:** Focused on DSAR handling, legal hold process, and redaction policies.
- **New Hire Onboarding:** Role-specific training modules within first 7 days; completion tracked here.

## Testing & Scanning Cadence

| Activity | Frequency | Owner | Evidence |
| --- | --- | --- | --- |
| External penetration test | Quarterly | Security | Vendor report + remediation plan |
| Vulnerability scan (container + SCA) | Monthly | DevSecOps | `security/sbom/` reports (TODO) |
| Dependency update review | Weekly | Platform | Renovate PRs + approvals |
| Security tabletop drill | Quarterly | Incident Response | Drill summary appended below |
| PCI ASV scan | Quarterly | Compliance | Approved Scanning Vendor report |
| Phishing simulation | Bi-monthly | People Ops | Participation metrics |

## Drill Log

| Date | Scenario | Participants | Outcome | Follow-ups |
| --- | --- | --- | --- | --- |
| 2025-10-12 | SEV2 search scraping & rate limit tuning | Security, Platform, Support | ✅ Resolved via WAF challenge; updated runbook. | Add BotControl metrics to dashboard. |
| 2025-11-05 | DSAR dry-run (export + delete) | Privacy, Data Eng | ✅ Completed in 3m45s. | Automate manifest upload evidence. |

## Training Log

| Employee | Module | Completed | Evidence |
| --- | --- | --- | --- |
| A. Rivera | Annual Security 2025 | 2025-09-15 | LMS certificate |
| B. Chen | Privacy Workshop Q4 | 2025-10-20 | Attendance sheet |

## Open Tasks

- [ ] Automate SBOM generation pipeline and add results to `security/sbom/`.
- [ ] Implement `tools/secrets/check_unused.py` scheduled job.
- [ ] Extend training catalog to include secure coding for contractors.
- [ ] Add SOC2 evidence mapping to `docs/security/training_and_drills.md`.
