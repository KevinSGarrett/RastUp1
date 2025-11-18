# Meta-QA Checklist

**Purpose**: Regular quality audits of agent work, run reports, and queue management  
**Frequency**: Weekly  
**Owner**: AGENT-4

---

## Overview

Meta-QA tasks ensure the quality of the development process itself, including agent run reports, documentation completeness, and queue health.

## Weekly Audit Tasks

### 1. Run Report Quality Audit

**Frequency**: Weekly (every Monday)  
**Time Required**: 30 minutes

#### Checklist

- [ ] Review all run reports from past week
- [ ] Verify all required sections present:
  - [ ] Context Snapshot
  - [ ] Plan vs Done vs Pending
  - [ ] How It Was Done
  - [ ] Testing (with proof)
  - [ ] Issues & Problems
  - [ ] Locations / Touch Map
  - [ ] Suggestions for Next Agents
  - [ ] Progress & Checklist
- [ ] Check testing evidence is comprehensive
- [ ] Verify attach packs are complete
- [ ] Validate scope paths declared
- [ ] Check for foreign changes or conflicts
- [ ] Review suggestions for next agents

#### Quality Metrics

Track in `ops/qa/run-report-quality.jsonl`:

```jsonl
{"date": "2025-11-18", "agent": "AGENT-1", "wbs": "WBS-021", "score": 95, "issues": ["Missing performance test results"], "reviewer": "AGENT-4"}
```

**Scoring**:
- All sections present: 40 points
- Testing comprehensive: 30 points
- Clear documentation: 20 points
- Attach pack complete: 10 points

**Target**: Average score ≥ 85

### 2. Documentation Completeness Audit

**Frequency**: Weekly (every Tuesday)  
**Time Required**: 20 minutes

#### Checklist

- [ ] All new features documented in:
  - [ ] Architecture docs (if architectural change)
  - [ ] ADRs (if significant decision)
  - [ ] Runbooks (if operational procedure)
  - [ ] API docs (if API change)
  - [ ] Security docs (if security control)
- [ ] Documentation is up-to-date
- [ ] Code examples are accurate
- [ ] Links are not broken
- [ ] Diagrams are current

#### Validation Commands

```bash
# Check for broken links
npm run docs:check-links

# Validate code examples
npm run docs:validate-examples

# Check documentation coverage
npm run docs:coverage
```

### 3. Queue Health Audit

**Frequency**: Weekly (every Wednesday)  
**Time Required**: 15 minutes

#### Checklist

- [ ] Review `ops/queue.jsonl`
- [ ] Check for stale tasks (> 2 weeks old)
- [ ] Verify dependencies are correct
- [ ] Check for blocked tasks
- [ ] Review priority ordering
- [ ] Validate agent assignments
- [ ] Check for duplicate tasks

#### Metrics

Track in `ops/qa/queue-health.jsonl`:

```jsonl
{"date": "2025-11-18", "total_tasks": 15, "stale_tasks": 2, "blocked_tasks": 1, "avg_age_days": 5, "reviewer": "AGENT-4"}
```

**Targets**:
- Stale tasks: 0
- Blocked tasks: < 2
- Average age: < 7 days

### 4. Test Coverage Audit

**Frequency**: Weekly (every Thursday)  
**Time Required**: 20 minutes

#### Checklist

- [ ] Overall code coverage ≥ 80%
- [ ] No decrease in coverage from last week
- [ ] Critical paths have E2E tests
- [ ] No skipped/quarantined tests > 7 days
- [ ] Security tests passing
- [ ] Performance tests passing

#### Validation Commands

```bash
# Check coverage
npm run test:coverage

# List skipped tests
npm run test:list-skipped

# Run security tests
npm run test:security

# Run performance tests
npm run test:performance
```

### 5. Security Posture Audit

**Frequency**: Weekly (every Friday)  
**Time Required**: 30 minutes

#### Checklist

- [ ] No critical or high vulnerabilities in dependencies
- [ ] Secrets rotation on schedule
- [ ] Access reviews up-to-date
- [ ] Audit logs reviewed for anomalies
- [ ] Security scan results reviewed
- [ ] Incident response drills scheduled
- [ ] Security training current

#### Validation Commands

```bash
# Dependency scan
npm audit --audit-level=high
snyk test --severity-threshold=high

# Secret scan
trufflehog git file://. --only-verified

# Check rotation schedule
npm run secrets:check-rotation

# Review audit logs
npm run audit:review -- --since=7d
```

### 6. Deployment Quality Audit

**Frequency**: Weekly (every Friday)  
**Time Required**: 15 minutes

#### Checklist

- [ ] All deployments followed runbook
- [ ] Rollback procedures tested
- [ ] Smoke tests passed
- [ ] No incidents during deployments
- [ ] Feature flags used appropriately
- [ ] Gradual rollout followed
- [ ] Post-deployment validation completed

#### Metrics

Track in `ops/qa/deployment-quality.jsonl`:

```jsonl
{"date": "2025-11-18", "deployments": 3, "incidents": 0, "rollbacks": 0, "avg_duration_min": 45, "reviewer": "AGENT-4"}
```

**Targets**:
- Incident rate: 0%
- Rollback rate: < 5%
- Average duration: < 60 minutes

## Monthly Audit Tasks

### 1. Architecture Review

**Frequency**: Monthly (first Monday)  
**Time Required**: 2 hours

#### Checklist

- [ ] Review ARCHITECTURE.md for accuracy
- [ ] Update technology stack if changed
- [ ] Review ADRs for relevance
- [ ] Check for architectural drift
- [ ] Identify technical debt
- [ ] Plan refactoring if needed

### 2. Risk Register Review

**Frequency**: Monthly (second Monday)  
**Time Required**: 1 hour

#### Checklist

- [ ] Review all risks in RISKS.md
- [ ] Update probability and impact
- [ ] Check mitigation effectiveness
- [ ] Identify new risks
- [ ] Archive resolved risks
- [ ] Escalate critical risks

### 3. Compliance Audit

**Frequency**: Monthly (third Monday)  
**Time Required**: 1 hour

#### Checklist

- [ ] GDPR compliance maintained
- [ ] PCI DSS requirements met
- [ ] SOC 2 controls validated
- [ ] Privacy policies up-to-date
- [ ] Data retention policies followed
- [ ] Breach notification procedures tested

### 4. Performance Baseline

**Frequency**: Monthly (fourth Monday)  
**Time Required**: 1 hour

#### Checklist

- [ ] Run performance tests
- [ ] Compare to baseline
- [ ] Identify regressions
- [ ] Update performance targets
- [ ] Plan optimizations if needed

## Quarterly Audit Tasks

### 1. Full Security Audit

**Frequency**: Quarterly  
**Time Required**: 1 day

#### Checklist

- [ ] Penetration testing
- [ ] Vulnerability assessment
- [ ] Access review (all users)
- [ ] Secret rotation audit
- [ ] Incident response drill
- [ ] Security training completion
- [ ] Third-party security reviews

### 2. Disaster Recovery Drill

**Frequency**: Quarterly  
**Time Required**: 4 hours

#### Checklist

- [ ] Database restore from backup
- [ ] Service failover
- [ ] Communication procedures
- [ ] RTO/RPO validation
- [ ] Runbook accuracy
- [ ] Team readiness

### 3. Documentation Refresh

**Frequency**: Quarterly  
**Time Required**: 1 day

#### Checklist

- [ ] Review all documentation
- [ ] Update outdated content
- [ ] Add missing documentation
- [ ] Improve clarity and examples
- [ ] Validate all links and code
- [ ] Gather feedback from team

## Reporting

### Weekly Report Template

```markdown
# Meta-QA Weekly Report - Week of YYYY-MM-DD

## Summary
- Run reports reviewed: X
- Documentation updates: Y
- Issues found: Z
- Overall health: Green/Yellow/Red

## Run Report Quality
- Average score: XX/100
- Issues: [List]
- Recommendations: [List]

## Documentation Completeness
- Coverage: XX%
- Missing docs: [List]
- Actions: [List]

## Queue Health
- Total tasks: X
- Stale tasks: Y
- Blocked tasks: Z
- Actions: [List]

## Test Coverage
- Overall: XX%
- Change: +/-X%
- Gaps: [List]

## Security Posture
- Vulnerabilities: X critical, Y high
- Actions: [List]

## Deployment Quality
- Deployments: X
- Incidents: Y
- Rollbacks: Z
- Success rate: XX%

## Action Items
1. [Action with owner and due date]
2. [Action with owner and due date]
```

### Escalation Criteria

Escalate to Engineering Manager if:
- Run report quality score < 70
- Test coverage < 75%
- Critical/high vulnerabilities unresolved > 7 days
- Deployment incident rate > 10%
- Stale tasks > 5
- Documentation gaps in critical areas

## Automation

### Automated Checks

```bash
# Daily automated checks (CI)
npm run qa:daily

# Weekly automated report
npm run qa:weekly-report

# Monthly automated metrics
npm run qa:monthly-metrics
```

### Scripts

Create scripts in `ops/qa/scripts/`:
- `check-run-reports.py` - Validate run report completeness
- `check-documentation.py` - Check documentation coverage
- `check-queue-health.py` - Analyze queue status
- `check-test-coverage.py` - Validate test coverage
- `generate-report.py` - Generate weekly report

## References

- Run Reports: `docs/runs/`
- Documentation: `docs/`
- Queue: `ops/queue.jsonl`
- Test Results: CI artifacts
- Security Scans: `ops/qa/security-scans/`

---

**Review Cadence**: This checklist reviewed and updated quarterly
