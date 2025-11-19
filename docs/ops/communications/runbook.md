# Runbook — Communications & Notifications System

## Purpose

Provide operational procedures for monitoring, incident response, maintenance, and compliance of the communications stack defined in WBS-015 (§1.10).

## System Boundaries

- **Included Components:** Comms Router (Lambda), SQS queues (`comms-email`, `comms-push`, `comms-sms`, `comms-digest`), EventBridge bus (`comms.events`), Aurora tables (`comms_*`), DynamoDB tables (`comms_tokens`, `comms_dedupe`, `comms_scheduled`, `comms_soft_bounce`), S3 buckets (`comms-rendered`, `comms-admin-exports`), SES/SNS/Pinpoint, Twilio adapter, AppSync notification API, Admin console.
- **External Dependencies:** Identity service (user timezone, locale), AppConfig (feature flags, cost gates), Secrets Manager (provider credentials), Analytics pipeline (Looker dashboards).

## Baseline Health Checks

- **Every 5 minutes (automated synthetic job):**
  - Publish test event (`comms.synthetic.probe`) verifying email, push, SMS (sandbox), and in-app delivery. Record `msg_id` and delivery lag in CloudWatch `SyntheticLatency` metric.
  - Query AppSync `notifications` for synthetic user verifying in-app unread count.
  - Call `/unsubscribe/{token}` endpoint ensuring HTTPS + HSTS headers.
- **Continuous metrics monitors:** CloudWatch alarms for queue depth, router error rate, bounce %, complaint %, SMS spend.
- **Daily manual review:** Deliverability dashboards (SES reputation, Pinpoint analytics), suppression list delta report, cost envelope summary.

## Incident Response Playbooks

### P0 — Critical Deliverability Failure

Symptoms: Delivery rate < 90%, SES sending paused, DNS misconfiguration, AppSync errors impacting all channels.

1. **Triage:** Check CloudWatch `DeliveryRate` alarm payload; confirm scope via dashboards.
2. **Containment:** 
   - Pause non-critical sends by toggling AppConfig flag `comms.channels.non_critical.enabled=false`.
   - For SES suspension: open AWS support P0 case, switch to backup provider (SendGrid adapter) if authorized.
   - For DNS issues: validate SPF/DKIM/DMARC records via `dig` and `aws ses get-identity-dkim-attributes`.
3. **Remediation:** 
   - If bounce surge: inspect `comms_suppression` recent entries, identify template causing issue, disable via admin console.
   - For code regressions: rollback latest Lambda/queue deployments via CI pipeline.
4. **Recovery Verification:** Run synthetic probe; ensure delivery metrics recover above thresholds for 30 minutes.
5. **Post-Incident:** File RCA within 24 hours, update `comms` runbook and add guardrails (alerts/tests).

### P1 — Quiet Hours Scheduler Backlog

Symptoms: `QuietHoursBacklog` alarm triggered, `comms_scheduled` DynamoDB table growing, delayed sends.

1. Inspect Lambda `quiet-hours-drain` logs; verify concurrency limits.
2. Increase reserved concurrency temporarily (via `aws lambda put-function-concurrency`) or clear stuck items.
3. Validate EventBridge Scheduler rule `comms-quiet-hours-drain` still enabled.
4. Post resolution, analyse backlog cause (spike vs scheduler failure); document in ops journal.

### P1 — SMS Cost Spike

Symptoms: `SMSCostAnomaly` alert, cost per 1k > budget.

1. Review AppConfig `sms.allowed_categories` — temporarily disable non-critical categories.
2. Check `comms_message` for high-volume campaigns; confirm marketing digests respect quotas.
3. Notify Finance (Slack `#finops-alerts`); update daily cost report.
4. After mitigation, run retrospective to adjust automation thresholds.

### P2 — Admin Console Actions Failing

1. Verify Amplify Admin UI deployment status; check CloudFront logs.
2. Inspect AppSync resolver CloudWatch logs for GraphQL errors.
3. Validate IAM credentials for `CommsApprover` role; confirm Secrets Manager rotation succeeded.
4. Apply hotfix or rollback; notify admin users with ETA.

### P3 — Individual Channel Degradation

1. Email: check SES sending quota, ensure bounce rate <0.3%.
2. Push: inspect `comms_tokens` invalidation rate, regenerate APNs token if expired.
3. SMS: confirm Twilio credentials valid; run test send using sandbox numbers.
4. In-app: validate Aurora health, AppSync latency metrics.

## Maintenance Procedures

- **Weekly:**
  - Review suppression list churn; export weekly snapshot to `comms-admin-exports`.
  - Validate synthetic test outputs appended to `logs/autopilot.log`.
  - Rotate HMAC secret for link wrapper if flagged by security team.
- **Monthly:**
  - Audit template catalog for stale versions; archive unused variants.
  - Run DR drill for Router + Workers (deploy to stage, trigger failover).
  - Review `comms_audit` logs for unusual admin activity.
- **Quarterly:**
  - Rotate DKIM keys, APNs tokens, Twilio auth tokens.
  - Execute compliance review: TCPA consent logs, GDPR erasure handling.
  - Update runbook and training material; rehearse incident simulations.

## Change Management

- All code/config changes require:
  - Passing `make ci` including communications doc/tests.
  - Updated attach pack with diff summaries and testing evidence.
  - Change request ticket referencing WBS-015, deployment plan, rollback steps.
- Production deploys gated by approvals from Security + Product for comms-impacting changes.

## Operational Tooling

- **CLI Utilities (future work):**
  - `tools/comms/preflight.py` — verify provider credentials, AppConfig flags, suppression sync.
  - `tools/comms/digest_simulator.py` — simulate digest output for QA.
  - `tools/comms/audit_export.py` — export `comms_audit` entries for compliance review.
- **Dashboards:**
  - CloudWatch dashboard `Comms-Overview`.
  - Looker board `Comms Funnel` (delivery→open→click→conversion).

## Escalation Matrix

- **Primary On-call:** Comms SRE (rotation under Ops).
- **Secondary:** Platform SRE.
- **Tertiary:** Product Manager for Communications.
- **External:** AWS Support Enterprise, Twilio Account Manager, Firebase support.

Escalation triggered when:

- P0 unresolved > 15 minutes.
- P1 unresolved > 1 hour.
- Repeated P2/P3 incidents within week.

## Post-Incident Checklist

1. Add timeline to `docs/runs/<date>-incident-log.md`.
2. Update suppression or preference policies if root cause tied to content.
3. Ensure synthetic probes include regression coverage.
4. Communicate summary to stakeholders (Slack + weekly ops review).

## References

- `docs/ops/communications/communications_system.md`
- `observability/dashboards/comms_metrics.md` (to author)
- AWS runbooks: `ops/runbooks/RB-N-01_regional_failover.md`, `RB-Z-incident_template.md`
- Legal policies: `privacy/data_lifecycle.md`, `docs/security/`

