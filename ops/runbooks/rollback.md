# Rollback Runbook

**Owner:** DevOps (AGENT-1)  
**Last Updated:** 2025-11-18  
**Applies to:** All production services and infrastructure

---

## Overview

This runbook provides detailed procedures for rolling back deployments, database changes, and infrastructure modifications when issues are detected in production.

## Rollback Decision Matrix

| Severity | Trigger | Response Time | Approval Required |
|----------|---------|---------------|-------------------|
| **SEV-0** | Informational, no impact | Standard process | Yes (2 approvers) |
| **SEV-1** | Minor degradation, < 5% users | 30 minutes | Yes (1 approver) |
| **SEV-2** | Significant degradation, 5-25% users | 15 minutes | On-call engineer |
| **SEV-3** | Major outage, > 25% users | 5 minutes | On-call engineer |
| **SEV-4** | Complete outage, security breach | Immediate | On-call engineer |

## Quick Rollback Commands

### Application Services

```bash
# Rollback to previous version
npm run deploy:rollback -- --service=api --to-version=v1.2.2

# Or use AWS CLI
aws ecs update-service \
  --cluster rastup-prod \
  --service api-service \
  --task-definition api-service:42  # previous task definition

# Verify rollback
curl https://api.rastup.com/version
```

### Feature Flags (Fastest)

```bash
# Kill switch for specific feature
npm run flags:disable -- --flag=new_feature_enabled --all-cities

# Or via AWS AppConfig console
# Navigate to AppConfig → Configuration → Kill Switches → Enable
```

### Database Migrations

```bash
# Rollback last migration (if safe)
npm run migrate:rollback -- --env=production --steps=1

# Verify schema
npm run db:validate -- --env=production
```

### Frontend (Static Assets)

```bash
# Revert S3 objects to previous version
aws s3 sync s3://rastup-prod-frontend/v1.2.2/ s3://rastup-prod-frontend/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

## Detailed Rollback Procedures

### 1. Application Service Rollback

#### Step 1: Identify Previous Stable Version

```bash
# List recent deployments
npm run deploy:history -- --service=api --limit=10

# Or check git tags
git tag -l "v*" --sort=-version:refname | head -10

# Verify previous version in staging
npm run deploy:staging -- --version=v1.2.2
npm run test:smoke -- --env=staging
```

#### Step 2: Execute Rollback

```bash
# Shift traffic back to previous version
npm run deploy:rollback -- \
  --service=api \
  --to-version=v1.2.2 \
  --rollout-percentage=100

# For gradual rollback (if time permits):
npm run deploy:rollback -- \
  --service=api \
  --to-version=v1.2.2 \
  --rollout-percentage=50

# Wait 5 minutes, monitor metrics

npm run deploy:rollback -- \
  --service=api \
  --to-version=v1.2.2 \
  --rollout-percentage=100
```

#### Step 3: Validate Rollback

```bash
# Check service health
curl https://api.rastup.com/health
curl https://api.rastup.com/ready

# Verify version
curl https://api.rastup.com/version
# Expected: {"version": "v1.2.2", ...}

# Run smoke tests
npm run test:smoke -- --env=production

# Check error rates
npm run metrics:errors -- --window=5m --compare-to-baseline
```

#### Step 4: Monitor Post-Rollback

Monitor for 30 minutes after rollback:

- Error rates return to baseline
- Latency returns to normal
- Business metrics stabilize
- No new alerts triggered

### 2. Database Rollback

⚠️ **DANGER**: Database rollbacks are risky and should be avoided. Always design migrations to be backward-compatible.

#### Safe Rollback (Additive Changes Only)

If migration only added columns/tables (no data loss):

```bash
# Rollback migration
npm run migrate:rollback -- --env=production --steps=1

# Verify schema
npm run db:validate -- --env=production

# Check application compatibility
npm run test:smoke -- --env=production
```

#### Unsafe Rollback (Data Loss Risk)

If migration modified/deleted data:

```bash
# DO NOT use migrate:rollback
# Instead, restore from snapshot

# 1. Identify snapshot
aws rds describe-db-snapshots \
  --db-instance-identifier rastup-prod \
  --query 'DBSnapshots[?SnapshotCreateTime>`2025-11-18T14:00:00Z`]'

# 2. Create new instance from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier rastup-prod-rollback \
  --db-snapshot-identifier pre-deploy-20251118-140000 \
  --db-instance-class db.r6g.2xlarge \
  --multi-az

# 3. Wait for instance to be available (10-15 minutes)
aws rds wait db-instance-available \
  --db-instance-identifier rastup-prod-rollback

# 4. Update application to use rollback instance
# (See DR runbook for DNS/connection string updates)

# 5. Validate data integrity
npm run db:validate -- --env=production
npm run test:data-integrity -- --env=production
```

#### Post-Migration Rollback

If migration succeeded but application incompatible:

```bash
# Rollback application first
npm run deploy:rollback -- --service=api --to-version=v1.2.2

# Migration can stay (if backward compatible)
# Or rollback migration if safe
npm run migrate:rollback -- --env=production --steps=1
```

### 3. Infrastructure Rollback

#### Terraform/CDK Changes

```bash
# Identify previous state
cd infrastructure/
git log --oneline -10

# Checkout previous version
git checkout <previous-commit>

# Plan rollback
terraform plan -out=rollback.plan

# Review plan carefully
terraform show rollback.plan

# Apply rollback
terraform apply rollback.plan

# Verify infrastructure
npm run infra:validate -- --env=production
```

#### Configuration Changes

```bash
# Rollback AppConfig configuration
aws appconfig start-deployment \
  --application-id <app-id> \
  --environment-id <env-id> \
  --deployment-strategy-id <strategy-id> \
  --configuration-profile-id <profile-id> \
  --configuration-version <previous-version>

# Rollback Secrets Manager secret
aws secretsmanager update-secret-version-stage \
  --secret-id rastup/prod/api-key \
  --version-stage AWSCURRENT \
  --remove-from-version-id <new-version> \
  --move-to-version-id <previous-version>
```

### 4. Feature Flag Rollback

Fastest rollback method for feature-related issues:

```bash
# Disable feature globally
npm run flags:disable -- --flag=new_feature_enabled --all-cities

# Or reduce rollout percentage
npm run flags:update -- \
  --flag=new_feature_enabled \
  --city=los-angeles \
  --percentage=0

# Or enable kill switch
npm run flags:kill-switch -- --flag=payments_disabled --enable

# Verify flag state
npm run flags:get -- --flag=new_feature_enabled --city=los-angeles
```

### 5. Lambda Function Rollback

```bash
# List function versions
aws lambda list-versions-by-function \
  --function-name rastup-search-indexer

# Update alias to previous version
aws lambda update-alias \
  --function-name rastup-search-indexer \
  --name production \
  --function-version 42  # previous version

# Verify
aws lambda get-alias \
  --function-name rastup-search-indexer \
  --name production
```

### 6. Frontend Rollback

```bash
# Option 1: S3 version rollback
aws s3api list-object-versions \
  --bucket rastup-prod-frontend \
  --prefix index.html

aws s3api copy-object \
  --bucket rastup-prod-frontend \
  --copy-source rastup-prod-frontend/index.html?versionId=<previous-version> \
  --key index.html

# Option 2: Sync from previous version
aws s3 sync s3://rastup-prod-frontend-versions/v1.2.2/ \
  s3://rastup-prod-frontend/ \
  --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"

# Wait for invalidation (5-10 minutes)
aws cloudfront wait invalidation-completed \
  --distribution-id E1234567890ABC \
  --id <invalidation-id>

# Verify
curl -I https://rastup.com/ | grep -i x-cache
# Should see "Miss from cloudfront" initially, then "Hit from cloudfront"
```

## Rollback Validation Checklist

After any rollback:

- [ ] Service health checks passing
- [ ] Version endpoint returns expected version
- [ ] Error rates at or below baseline
- [ ] Latency at or below baseline
- [ ] Business metrics stable
- [ ] No new alerts triggered
- [ ] Smoke tests passing
- [ ] Key user flows validated (search, booking, payment)
- [ ] Database connections healthy
- [ ] External integrations working (Stripe, Twilio, etc.)

## Post-Rollback Actions

### 1. Immediate (< 1 hour)

- [ ] Post rollback completion in `#incidents` channel
- [ ] Update status page (if customer-facing)
- [ ] Notify stakeholders (PM, leadership)
- [ ] Create incident ticket
- [ ] Document timeline and actions taken

### 2. Short-term (< 24 hours)

- [ ] Root cause analysis
- [ ] Identify what went wrong
- [ ] Document lessons learned
- [ ] Update deployment checklist
- [ ] Schedule post-mortem meeting

### 3. Long-term (< 1 week)

- [ ] Conduct post-mortem
- [ ] Create action items to prevent recurrence
- [ ] Update runbooks and documentation
- [ ] Improve monitoring and alerting
- [ ] Add new tests to catch issue earlier

## Common Rollback Scenarios

### Scenario 1: High Error Rate After Deployment

**Symptoms**: Error rate > 0.5% above baseline

**Actions**:
1. Check error tracking (Sentry) for new error types
2. If errors related to new code: rollback application
3. If errors related to external service: check service status
4. If errors related to data: investigate database state

**Rollback**: Application service rollback (fastest)

### Scenario 2: Performance Degradation

**Symptoms**: Latency p95 > 25% above baseline

**Actions**:
1. Check APM traces for slow operations
2. Check database query performance
3. Check external service latency
4. If related to new code: rollback application
5. If related to database: check query plans, consider scaling

**Rollback**: Application service rollback or feature flag disable

### Scenario 3: Database Migration Failure

**Symptoms**: Migration script fails or times out

**Actions**:
1. Check migration logs for error
2. Check database locks and active queries
3. If migration can be retried: fix and retry
4. If migration caused corruption: restore from snapshot

**Rollback**: Migration rollback (if safe) or database restore

### Scenario 4: Business Metric Drop

**Symptoms**: Search conversion, booking completion, or payment success rate drops > 10%

**Actions**:
1. Check if related to new feature (A/B test data)
2. Check for errors in affected flow
3. Check for UI/UX issues (frontend logs)
4. If related to new feature: disable feature flag
5. If related to backend: rollback application

**Rollback**: Feature flag disable (fastest) or application rollback

### Scenario 5: Security Vulnerability

**Symptoms**: Security vulnerability discovered in deployed code

**Actions**:
1. Assess severity and exploitability
2. If actively exploited: immediate rollback
3. If not yet exploited: disable affected feature via flag
4. Develop and test fix
5. Deploy hotfix

**Rollback**: Feature flag kill switch (immediate) or application rollback

## Rollback Testing

Regularly test rollback procedures:

- **Monthly**: Simulate application rollback in staging
- **Quarterly**: Simulate database restore from snapshot
- **Annually**: Full disaster recovery drill including rollback

## Automation

Automated rollback triggers:

```yaml
# .github/workflows/auto-rollback.yml
name: Auto Rollback

on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes

jobs:
  check-health:
    runs-on: ubuntu-latest
    steps:
      - name: Check error rate
        run: |
          ERROR_RATE=$(npm run metrics:errors -- --window=5m --json | jq '.rate')
          if (( $(echo "$ERROR_RATE > 0.5" | bc -l) )); then
            echo "Error rate $ERROR_RATE exceeds threshold, triggering rollback"
            npm run deploy:rollback -- --service=api --auto
            npm run alerts:send -- --channel=incidents --message="Auto-rollback triggered due to high error rate"
          fi
```

## References

- Deployment Runbook: `ops/runbooks/deployment.md`
- Incident Response: `ops/runbooks/incident_response.md`
- DR Procedures: `ops/dr/`
- Monitoring Dashboard: https://datadog.rastup.com/dashboard/deployments

## Contacts

- **Primary On-Call**: DevOps rotation (PagerDuty)
- **Secondary**: Engineering Manager
- **Database Issues**: Database Administrator
- **Security Issues**: Security Engineer

---

**Remember**: When in doubt, rollback. It's easier to re-deploy a fix than to recover from data corruption or extended outage.
