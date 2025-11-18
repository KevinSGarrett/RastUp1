# Analytics Runbooks

Status: Draft v0.1  
Owner: Data Platform Operations  
Scope: WBS-020 — governance change management, incident response, and compliance workflows.

## 1. Data Governance Change Control

**Trigger:** New table/model, schema change, or KPI definition update.

1. **Proposal**
   - Author RFC in analytics Notion including change summary, affected datasets, privacy tier.
   - Link RFC in `governance_change_log` table (`change_id`, `submitted_by`, `impact`, `status`).
2. **Review**
   - Data Platform + Domain owner review within 2 business days.
   - Evaluate privacy impact; involve Privacy if new PII fields appear.
3. **Implementation Plan**
   - Update dbt models, tests, and metrics catalog.
   - Schedule deployment window; ensure backfill script ready.
   - Update dashboards to consume new fields.
4. **Rollout**
   - Merge PR with all tests passing (dbt, Great Expectations, unit tests).
   - Deploy during off-peak window; monitor freshness.
5. **Verification**
   - Compare pre/post metrics, run smoke queries.
   - Update `governance_change_log` status to `verified` with metrics.
6. **Communication**
   - Notify affected stakeholders via Slack/Email with summary, new field docs.

Escalate to Chief Data Officer if change impacts regulatory reporting.

## 2. Analytics Incident Response

**Trigger:** Data quality failure, pipeline outage, schema drift, cost anomaly.

1. **Detection**
   - Alert from PagerDuty (`data-platform` service) with context (suite, dataset, severity).
2. **Triage (Primary On-Call)**
   - Acknowledge within 5 minutes.
   - Review run history (`analytics_job_run`) and CloudWatch metrics.
   - Determine scope: which tables/dashboards impacted?
3. **Containment**
   - Pause downstream jobs (dbt, QuickSight refresh) if data incorrect.
   - Enable Safe Mode banners in dashboards if metrics stale (predefined API).
4. **Mitigation**
   - Fix root cause (schema mismatch, upstream service outage, cost guardrail).
   - Re-run failed jobs with backfill partition range.
5. **Validation**
   - Confirm data quality suites pass.
   - Remove Safe Mode banner after verification.
6. **Communication**
   - Post incident summary in `#data-incident` Slack with ETA for resolution.
   - Notify stakeholders (Finance, Growth, Trust) if KPIs impacted > 1 cycle.
7. **Postmortem**
   - Within 48 hours, file postmortem including timeline, root cause, corrective actions.
   - Update `data_incident` table (`incident_id`, `start_at`, `end_at`, `impact`, `rca`, `follow_up_actions`).

PagerDuty Escalation Path:  
Primary On-call → Secondary On-call → Head of Data Platform.

## 3. Compliance & Privacy Runbook

**Trigger:** DSAR request, legal hold, or audit inquiry.

1. **Intake**
   - Support enters DSAR in system; automation populates `dsar_request`.
   - Verify identity according to DSAR playbook.
2. **Execution**
   - Step Function `dsar_orchestrator` kicks off export/delete path (see `data_quality.md` §5).
   - Monitor execution in AWS Console; ensure no failed steps.
3. **Validation**
   - Review `dsar_audit_log` for each dataset touched.
   - Run `SELECT COUNT(*)` from `silver_private` to confirm zero residual rows for deleted user.
4. **Completion**
   - Update `dsar_request.status = 'complete'`, attach export bundle hash if applicable.
   - Notify requester with secure download link or confirmation.
5. **Legal Hold**
   - If legal hold added: set `legal_hold_flag = true` in `data_retention_policy` for relevant datasets; pause purge jobs.
   - Document hold reason and reviewer.
6. **Audit Response**
   - Provide evidence bundle from `s3://compliance-artifacts/data-quality/`.
   - Ensure audit logs accessible for 7 years.

Escalation contact: Privacy Officer + Legal team if DSAR SLA (>30 days) at risk.

## 4. Cost Anomaly Remediation

**Trigger:** Cost anomaly alert or budget > 80%.

1. Identify offending service/query via AWS Cost Explorer or `cost_controls.anomalies`.
2. For Athena overruns, inspect query text, enforce partition filter, notify analyst/owner.
3. For S3 growth spikes, confirm lifecycle jobs running; evaluate compaction backlog.
4. Update incident log with mitigation (query cancelled, dataset compacted, QuickSight refresh throttled).
5. Review monthly with FinOps to adjust budgets or enforce new guardrails.

## 5. Onboarding Checklist for New Operators

- Gain access to:
  - AWS accounts (Analytics, Shared Services).
  - QuickSight author workspace.
  - PagerDuty service.
  - DataHub (when available).
- Review:
  - `architecture.md`, `data_quality.md`, `cost_controls.md`.
  - DSAR playbook.
  - Experimentation framework.
- Shadow on-call for one rotation before taking primary duty.

## 6. Open Items

- Automate Safe Mode banner toggling via API call from incident bot.
- Document handoff to Business Continuity team for analytics DR (disaster recovery).
