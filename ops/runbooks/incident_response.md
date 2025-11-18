# Incident Response Runbook

**Owner:** Security & Reliability Engineering  
**Policy Reference:** Appendix Z — Incident Management

## 1. Severity Ladder

| SEV | Description | Examples | Target RTO | Comms Cadence |
| --- | --- | --- | --- | --- |
| 0 | Informational | Scheduled maintenance, noise-only alerts | n/a | Status page optional |
| 1 | Minor impact | Single feature degraded with workaround | 8 h | Internal Slack updates every 2 h |
| 2 | Major impact | Checkout errors \< 15%, partial data exposure | 4 h | Status page & email, hourly updates |
| 3 | Critical | Full outage, security breach, data corruption | 1 h | Continuous bridge, 30 min updates |
| 4 | Catastrophic | Multi-region impact, legal required notifications | asap | Executive bridge, PR/legal lead |

## 2. Activation

1. On-call reviews alert, classifies severity, and triggers PagerDuty incident template.
2. Post confirmation, flip `global-readonly` flag if data integrity at risk.
3. Notify incident channels:
   - `#incident-war-room`
   - `security@rastup.com`
   - Exec SMS list for SEV3+.
4. Assign roles: Incident Commander (IC), Communications Lead, Scribe, Subject Matter Experts.

## 3. Containment & Eradication

- Validate alarms and log entries using guidance in `observability/log_schema.md`.
- For security incidents:
  - Capture evidence: snapshot audit logs, KMS decrypt logs, WAF metrics.
  - Isolate compromised credentials (invoke `ops/runbooks/secret_rotation.md` if needed).
  - Engage legal/compliance for potential breach notifications.
- For infrastructure impact:
  - Follow DR playbooks in `ops/dr/*.md` (Aurora restore, Typesense rebuild, DNS failover).

## 4. Communication Templates

- **Status Page (SEV2+):**  
  “We are investigating an issue impacting <service>. Mitigation is in progress. Next update in {{X}} minutes.”
- **Customer Email (SEV3 security):**  
  “On {{timestamp}} UTC we detected unauthorized access to <scope>. We revoked exposed credentials, enabled additional controls, and recommend password resets for affected accounts. Affected users will receive individual instructions.”
- **Regulators (GDPR/PCI):**  
  Coordinate with counsel; deliver incident summary, containment measures, and mitigation timeline within mandated SLA.

## 5. Recovery

1. Validate service health via synthetic monitors.
2. Remove read-only flag and monitor error rates for 30 minutes.
3. Confirm audit log chain hash continuity and store summary in `docs/security/incident_postmortems/<YYYYMMDD>-<slug>.md`.

## 6. Post-Incident Review

- Schedule review within 5 business days.
- Required artefacts:
  - Timeline
  - Root cause analysis (5-Whys or Fishbone)
  - Action items (owner + due date)
  - Detection improvement plan
- Upload to audit vault and link in `docs/PROGRESS.md`.

## 7. Drills

- Conduct quarterly SEV2 tabletop exercises and annual SEV3 full drill.
- Track completion and outcomes in `docs/security/training_and_drills.md`.

## 8. Contacts

- **Incident Commander rotation:** SRE on-call
- **Security liaison:** security@rastup.com
- **Legal counsel:** legal@rastup.com
- **PR lead:** comms@rastup.com
