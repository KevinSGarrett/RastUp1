# Deployment Runbook

**Owner:** DevOps (AGENT-1)  
**Last Updated:** 2025-11-18  
**Applies to:** All application services and infrastructure

---

## Overview

This runbook covers standard deployment procedures for RastUp platform services, including pre-deployment checks, deployment steps, validation, and rollback procedures.

## Deployment Strategy

We use **blue/green deployments** with feature flags for zero-downtime releases:

1. Deploy new version alongside existing version
2. Run smoke tests on new version
3. Gradually shift traffic (10% → 50% → 100%)
4. Monitor metrics and error rates
5. Complete cutover or rollback if issues detected

## Pre-Deployment Checklist

- [ ] All CI checks passing (tests, linting, security scans)
- [ ] Code review approved by 2+ engineers
- [ ] Database migrations tested in staging
- [ ] Feature flags configured for gradual rollout
- [ ] Runbook reviewed for new features
- [ ] On-call engineer notified
- [ ] Deployment window scheduled (avoid peak hours)
- [ ] Rollback plan documented

## Deployment Environments

| Environment | Purpose | Auto-Deploy | Approval Required |
|------------|---------|-------------|-------------------|
| Dev | Development testing | Yes (on push to `develop`) | No |
| Staging | Pre-production validation | Yes (on push to `main`) | No |
| Production | Live user traffic | No | Yes (2 approvers) |

## Standard Deployment Process

### 1. Prepare Release

```bash
# Create release branch
git checkout main
git pull origin main
git checkout -b release/v1.2.3

# Update version
npm version 1.2.3
git push origin release/v1.2.3

# Create pull request to main
gh pr create --title "Release v1.2.3" --body "$(cat CHANGELOG.md)"
```

### 2. Deploy to Staging

```bash
# Merge to main (triggers auto-deploy to staging)
gh pr merge --auto --squash

# Wait for deployment
gh run watch

# Run smoke tests
npm run test:smoke -- --env=staging

# Validate key flows
npm run test:e2e -- --env=staging --suite=critical
```

### 3. Database Migrations (if needed)

```bash
# Review migration
cat db/migrations/026_new_feature.sql

# Apply to staging
npm run migrate:staging

# Validate schema
npm run db:validate -- --env=staging

# Backup production database
aws rds create-db-snapshot \
  --db-instance-identifier rastup-prod \
  --db-snapshot-identifier pre-deploy-$(date +%Y%m%d-%H%M%S)

# Apply to production (during deployment)
npm run migrate:production
```

### 4. Deploy to Production

```bash
# Tag release
git tag v1.2.3
git push origin v1.2.3

# Trigger production deployment
gh workflow run deploy-production.yml \
  --ref v1.2.3 \
  --field environment=production \
  --field rollout_percentage=10

# Monitor deployment
gh run watch

# Check health endpoints
curl https://api.rastup.com/health
curl https://api.rastup.com/ready

# Validate metrics dashboard
open https://datadog.rastup.com/dashboard/production
```

### 5. Gradual Traffic Shift

```bash
# Increase to 50%
gh workflow run deploy-production.yml \
  --ref v1.2.3 \
  --field rollout_percentage=50

# Wait 15 minutes, monitor metrics
# Check error rates, latency, and key business metrics

# Increase to 100%
gh workflow run deploy-production.yml \
  --ref v1.2.3 \
  --field rollout_percentage=100

# Complete cutover
npm run deploy:complete -- --version=v1.2.3
```

### 6. Post-Deployment Validation

```bash
# Run smoke tests
npm run test:smoke -- --env=production

# Validate key metrics
npm run metrics:validate -- --baseline=v1.2.2 --current=v1.2.3

# Check error tracking
open https://sentry.io/rastup/production

# Verify feature flags
npm run flags:validate -- --env=production
```

## Service-Specific Deployments

### API Services (GraphQL, REST)

- **Deployment Method**: ECS Fargate rolling update
- **Health Check**: `/health` endpoint (200 OK)
- **Readiness Check**: `/ready` endpoint (checks DB, cache, external services)
- **Graceful Shutdown**: 30-second drain period for in-flight requests

### Lambda Functions

- **Deployment Method**: Blue/green with alias routing
- **Canary**: 10% traffic for 10 minutes, then 100%
- **Rollback**: Automatic on error rate > 1%

### Database Migrations

- **Backward Compatible**: All migrations must be backward compatible
- **Two-Phase Deploy**: 
  1. Deploy schema changes (additive only)
  2. Deploy code using new schema
  3. Remove old schema (in next release)

### Static Assets (Frontend)

- **Deployment Method**: S3 + CloudFront invalidation
- **Cache Invalidation**: `/*` pattern with versioned assets
- **Rollback**: Revert S3 objects and invalidate cache

## Feature Flag Rollout

For new features behind feature flags:

```bash
# Enable for internal users (0.1%)
npm run flags:update -- \
  --flag=new_feature_enabled \
  --city=los-angeles \
  --percentage=0.1

# Monitor for 24 hours

# Increase to 10%
npm run flags:update -- \
  --flag=new_feature_enabled \
  --city=los-angeles \
  --percentage=10

# Monitor for 24 hours

# Increase to 50%
npm run flags:update -- \
  --flag=new_feature_enabled \
  --city=los-angeles \
  --percentage=50

# Monitor for 24 hours

# Full rollout
npm run flags:update -- \
  --flag=new_feature_enabled \
  --city=los-angeles \
  --percentage=100
```

## Monitoring During Deployment

### Key Metrics to Watch

1. **Error Rates**
   - Target: < 0.1% increase
   - Alert threshold: > 0.5% increase

2. **Latency (p95)**
   - Target: < 10% increase
   - Alert threshold: > 25% increase

3. **Business Metrics**
   - Search conversion rate
   - Booking completion rate
   - Payment success rate

4. **Infrastructure**
   - CPU utilization < 70%
   - Memory utilization < 80%
   - Database connections < 80% of max

### Monitoring Commands

```bash
# Real-time error rate
npm run metrics:errors -- --window=5m

# Latency percentiles
npm run metrics:latency -- --percentiles=50,95,99

# Business metrics
npm run metrics:business -- --metrics=search_conversion,booking_completion

# Infrastructure health
npm run metrics:infra -- --services=api,search,messaging
```

## Rollback Procedures

### When to Rollback

- Error rate > 0.5% above baseline
- Latency p95 > 25% above baseline
- Critical business metric drops > 10%
- Security vulnerability discovered
- Data corruption detected

### Rollback Steps

#### 1. Immediate Rollback (< 5 minutes)

```bash
# Shift traffic back to previous version
npm run deploy:rollback -- --to-version=v1.2.2

# Or use feature flag kill switch
npm run flags:disable -- --flag=new_feature_enabled --all-cities

# Verify rollback
curl https://api.rastup.com/version
# Should return v1.2.2
```

#### 2. Database Rollback (if needed)

```bash
# Restore from snapshot (only if data corruption)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier rastup-prod-rollback \
  --db-snapshot-identifier pre-deploy-20251118-140000

# Update DNS to point to rollback instance
# (Follow DR runbook for detailed steps)
```

#### 3. Post-Rollback Actions

- [ ] Notify team in `#incidents` channel
- [ ] Create incident ticket with root cause analysis
- [ ] Document what went wrong
- [ ] Schedule post-mortem within 24 hours
- [ ] Update deployment checklist with new checks

## Emergency Hotfix Process

For critical production issues requiring immediate fix:

```bash
# Create hotfix branch from production tag
git checkout v1.2.3
git checkout -b hotfix/critical-bug

# Make minimal fix
# ... edit files ...

# Test locally
npm test

# Deploy directly to production (skip staging)
git commit -m "hotfix: Fix critical bug"
git tag v1.2.4-hotfix
git push origin v1.2.4-hotfix

# Deploy with fast rollout
gh workflow run deploy-production.yml \
  --ref v1.2.4-hotfix \
  --field rollout_percentage=100 \
  --field skip_canary=true

# Backport to main
git checkout main
git cherry-pick <hotfix-commit>
git push origin main
```

## Deployment Windows

### Preferred Windows
- **Weekdays**: 10 AM - 4 PM PT (avoid peak hours)
- **Avoid**: Fridays after 2 PM, weekends, holidays

### Blackout Periods
- Major holidays (Thanksgiving, Christmas, New Year's)
- Known high-traffic events (city launches, marketing campaigns)
- During active incidents

## Communication

### Before Deployment
- Post in `#engineering` channel: "Deploying v1.2.3 to production at 2 PM PT"
- Update status page if user-facing changes expected

### During Deployment
- Post progress updates every 15 minutes
- Alert on-call if issues detected

### After Deployment
- Post completion: "v1.2.3 deployed successfully, all metrics green"
- Update changelog and release notes
- Close deployment ticket

## Troubleshooting

### Deployment Stuck

```bash
# Check ECS service events
aws ecs describe-services \
  --cluster rastup-prod \
  --services api-service

# Check task health
aws ecs list-tasks \
  --cluster rastup-prod \
  --service-name api-service

# Force new deployment
aws ecs update-service \
  --cluster rastup-prod \
  --service api-service \
  --force-new-deployment
```

### Health Check Failing

```bash
# Check logs
aws logs tail /aws/ecs/rastup-prod/api-service --follow

# Check dependencies
curl https://api.rastup.com/ready
# Returns JSON with dependency status

# Common issues:
# - Database connection pool exhausted
# - Redis connection timeout
# - External service (Stripe, Twilio) down
```

### Migration Failed

```bash
# Check migration status
npm run migrate:status -- --env=production

# Rollback migration (if safe)
npm run migrate:rollback -- --env=production --steps=1

# Fix migration and retry
npm run migrate:production
```

## References

- CI/CD Pipeline: `.github/workflows/deploy-production.yml`
- Health Check Endpoints: `services/shared/health.ts`
- Feature Flags: `ops/config/flags.yaml`
- Monitoring Dashboard: https://datadog.rastup.com/dashboard/deployments
- Incident Response: `ops/runbooks/incident_response.md`

## Contacts

- **Primary On-Call**: DevOps rotation (PagerDuty)
- **Secondary**: Engineering Manager
- **Escalation**: CTO

---

**Checklist Summary**

- [ ] Pre-deployment checks complete
- [ ] Deployed to staging and validated
- [ ] Database migrations tested
- [ ] Production deployment with gradual rollout
- [ ] Metrics monitored at each stage
- [ ] Post-deployment validation passed
- [ ] Team notified of completion
