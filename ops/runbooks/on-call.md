# On-Call Runbook

**Owner:** Engineering Leadership  
**Last Updated:** 2025-11-18  
**Applies to:** All on-call engineers

---

## Overview

This runbook provides guidance for on-call engineers responding to production incidents, including escalation procedures, common issues, and troubleshooting steps.

## On-Call Rotation

- **Schedule**: 7-day rotation, Monday to Monday
- **Coverage**: 24/7 (primary + secondary)
- **Tool**: PagerDuty
- **Handoff**: Monday 10 AM PT

## Responsibilities

### Primary On-Call
- Respond to all PagerDuty alerts within 5 minutes
- Triage and resolve incidents
- Escalate to secondary if needed
- Document incidents and resolutions
- Conduct handoff at end of rotation

### Secondary On-Call
- Respond if primary doesn't acknowledge within 10 minutes
- Provide support for complex incidents
- Available for escalation

## Alert Response Workflow

```
1. Alert received (PagerDuty)
   ↓
2. Acknowledge within 5 minutes
   ↓
3. Assess severity (SEV-0 to SEV-4)
   ↓
4. Open incident channel (#incident-YYYYMMDD-HHMM)
   ↓
5. Investigate and mitigate
   ↓
6. Communicate status updates
   ↓
7. Resolve and document
   ↓
8. Schedule post-mortem (if SEV-2+)
```

## Severity Classification

| Level | Description | Response Time | Escalation |
|-------|-------------|---------------|------------|
| **SEV-0** | Informational, no user impact | Best effort | None |
| **SEV-1** | Minor degradation, < 5% users affected | 30 minutes | Optional |
| **SEV-2** | Significant degradation, 5-25% users | 15 minutes | Engineering Manager |
| **SEV-3** | Major outage, > 25% users affected | 5 minutes | Engineering Manager + CTO |
| **SEV-4** | Complete outage or security breach | Immediate | All hands |

## Initial Response Steps

### 1. Acknowledge Alert (< 5 minutes)

```bash
# Acknowledge in PagerDuty (mobile app or web)
# Or via CLI
pd incident:ack <incident-id>
```

### 2. Assess Situation (< 5 minutes)

- Check alert details and metrics
- Verify if real issue or false positive
- Check status page for known issues
- Review recent deployments

```bash
# Check recent deployments
npm run deploy:history -- --limit=5

# Check error rates
npm run metrics:errors -- --window=15m

# Check latency
npm run metrics:latency -- --window=15m

# Check service health
curl https://api.rastup.com/health
curl https://api.rastup.com/ready
```

### 3. Create Incident Channel (< 2 minutes)

```bash
# Create Slack channel
/incident create --severity=SEV-2 --title="High error rate in API"

# Or manually
# Create channel: #incident-20251118-1430
# Invite: @engineering-oncall @engineering-manager
# Post initial status
```

### 4. Classify Severity

Use the severity matrix above. When in doubt, classify higher.

### 5. Begin Investigation

See "Common Issues" section below for troubleshooting steps.

## Communication Guidelines

### Status Updates

- **SEV-1**: Every 2 hours
- **SEV-2**: Every hour
- **SEV-3**: Every 30 minutes
- **SEV-4**: Continuous updates

### Update Template

```
**Status Update** (HH:MM PT)
- Current status: [Investigating | Identified | Mitigating | Resolved]
- Impact: [X% of users affected]
- Actions taken: [List of actions]
- Next steps: [Planned actions]
- ETA: [Estimated resolution time]
```

### Channels

- **Internal**: `#incident-YYYYMMDD-HHMM` (Slack)
- **External**: Status page (for SEV-2+)
- **Executives**: SMS (for SEV-3+)

## Common Issues and Troubleshooting

### Issue 1: High Error Rate

**Symptoms**: Error rate > 0.5% above baseline

**Investigation**:
```bash
# Check error tracking
open https://sentry.io/rastup/production

# Check recent deployments
npm run deploy:history -- --limit=5

# Check error breakdown by endpoint
npm run metrics:errors -- --group-by=endpoint

# Check logs
aws logs tail /aws/ecs/rastup-prod/api-service --follow --filter-pattern="ERROR"
```

**Common Causes**:
- Recent deployment introduced bug
- External service (Stripe, Twilio) down
- Database connection pool exhausted
- Rate limiting triggered

**Mitigation**:
- Rollback recent deployment
- Disable feature flag
- Scale up service
- Contact external service support

### Issue 2: High Latency

**Symptoms**: p95 latency > 25% above baseline

**Investigation**:
```bash
# Check APM traces
open https://datadog.rastup.com/apm/traces

# Check database performance
npm run db:slow-queries -- --threshold=1000ms

# Check external service latency
npm run metrics:external-services -- --window=15m

# Check resource utilization
npm run metrics:infra -- --services=api,search,messaging
```

**Common Causes**:
- Slow database queries (missing index, lock contention)
- External service degradation
- High CPU/memory utilization
- Network issues

**Mitigation**:
- Optimize slow queries
- Scale up service
- Enable read replicas
- Contact external service support

### Issue 3: Service Unavailable

**Symptoms**: Health check failing, 503 errors

**Investigation**:
```bash
# Check service status
aws ecs describe-services --cluster rastup-prod --services api-service

# Check task health
aws ecs list-tasks --cluster rastup-prod --service-name api-service

# Check logs
aws logs tail /aws/ecs/rastup-prod/api-service --follow

# Check dependencies
curl https://api.rastup.com/ready
```

**Common Causes**:
- Service crashed (OOM, unhandled exception)
- Database unreachable
- Deployment stuck
- Resource exhaustion

**Mitigation**:
- Restart service
- Rollback deployment
- Scale up resources
- Check database connectivity

### Issue 4: Database Issues

**Symptoms**: Connection errors, slow queries, timeouts

**Investigation**:
```bash
# Check database status
aws rds describe-db-instances --db-instance-identifier rastup-prod

# Check connections
psql -h <db-host> -U admin -d rastup -c "SELECT count(*) FROM pg_stat_activity;"

# Check slow queries
psql -h <db-host> -U admin -d rastup -c "
  SELECT pid, now() - query_start AS duration, query 
  FROM pg_stat_activity 
  WHERE state = 'active' AND now() - query_start > interval '5 seconds'
  ORDER BY duration DESC;
"

# Check locks
psql -h <db-host> -U admin -d rastup -c "
  SELECT * FROM pg_locks 
  WHERE NOT granted;
"
```

**Common Causes**:
- Connection pool exhausted
- Long-running queries
- Lock contention
- Disk space full

**Mitigation**:
- Kill long-running queries
- Increase connection pool size
- Optimize queries
- Scale up database instance

### Issue 5: Payment Processing Failures

**Symptoms**: Stripe webhook failures, payment errors

**Investigation**:
```bash
# Check Stripe dashboard
open https://dashboard.stripe.com/webhooks

# Check webhook logs
npm run logs:webhooks -- --source=stripe --window=1h

# Check payment service logs
aws logs tail /aws/ecs/rastup-prod/payment-service --follow --filter-pattern="stripe"

# Check Stripe status
curl https://status.stripe.com/api/v2/status.json
```

**Common Causes**:
- Stripe webhook signature validation failing
- Stripe API rate limit
- Stripe service degradation
- Invalid payment method

**Mitigation**:
- Verify webhook secret
- Retry failed webhooks
- Contact Stripe support
- Communicate to users

### Issue 6: Search Not Working

**Symptoms**: Search returning no results, high latency

**Investigation**:
```bash
# Check Typesense health
curl https://typesense.rastup.com/health

# Check search service logs
aws logs tail /aws/lambda/rastup-search-indexer --follow

# Check outbox backlog
psql -h <db-host> -U admin -d rastup -c "
  SELECT count(*) FROM search.outbox WHERE processed = false;
"

# Check OpenSearch fallback
curl https://opensearch.rastup.com/_cluster/health
```

**Common Causes**:
- Typesense service down
- Outbox backlog (indexer failing)
- Index corruption
- OpenSearch fallback not working

**Mitigation**:
- Restart Typesense
- Enable OpenSearch fallback via feature flag
- Clear outbox backlog
- Trigger reindex

### Issue 7: Messaging Delays

**Symptoms**: Messages not delivered, high latency

**Investigation**:
```bash
# Check WebSocket connections
npm run metrics:websocket -- --window=15m

# Check message queue
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789/rastup-messages \
  --attribute-names ApproximateNumberOfMessages

# Check notification service
aws logs tail /aws/ecs/rastup-prod/notification-service --follow
```

**Common Causes**:
- WebSocket server overloaded
- SQS queue backlog
- Twilio/SendGrid rate limit
- Network issues

**Mitigation**:
- Scale up WebSocket servers
- Process SQS backlog
- Contact Twilio/SendGrid support
- Check network connectivity

## Escalation Procedures

### When to Escalate

- Unable to resolve within response time SLA
- Issue requires specialized expertise (database, security, etc.)
- SEV-3 or SEV-4 incident
- Multiple services affected
- Customer data at risk

### Escalation Contacts

| Role | Contact | When to Escalate |
|------|---------|------------------|
| Secondary On-Call | PagerDuty | Primary needs help |
| Engineering Manager | PagerDuty + Slack | SEV-2+ |
| Database Administrator | PagerDuty | Database issues |
| Security Engineer | PagerDuty | Security incidents |
| CTO | Phone + SMS | SEV-3+ |
| CEO | Phone | SEV-4 or PR impact |

### Escalation Template

```
@engineering-manager Escalating incident to SEV-3

**Summary**: High error rate (5%) affecting payment processing
**Impact**: 25% of users unable to complete bookings
**Duration**: 30 minutes
**Actions Taken**: 
  - Checked Stripe status (operational)
  - Reviewed logs (connection timeouts)
  - Attempted service restart (no improvement)
**Next Steps**: Need database expertise to investigate connection pool
**ETA**: Unknown
```

## Tools and Access

### Required Access

- AWS Console (production read-only, write via CLI with MFA)
- PagerDuty (on-call schedule and incidents)
- Slack (engineering channels)
- Sentry (error tracking)
- Datadog (metrics and APM)
- GitHub (code and deployments)

### Quick Links

- **Status Page**: https://status.rastup.com
- **Monitoring**: https://datadog.rastup.com/dashboard/production
- **Error Tracking**: https://sentry.io/rastup/production
- **APM**: https://datadog.rastup.com/apm
- **Logs**: https://console.aws.amazon.com/cloudwatch/logs
- **Deployments**: https://github.com/rastup/platform/actions
- **Runbooks**: https://github.com/rastup/platform/tree/main/ops/runbooks

### CLI Setup

```bash
# Install tools
npm install -g @rastup/cli

# Configure AWS CLI with MFA
aws configure --profile rastup-prod

# Configure PagerDuty CLI
pd auth:login

# Test access
npm run access:test -- --env=production
```

## Post-Incident Actions

### Immediate (< 1 hour after resolution)

- [ ] Update incident channel with resolution
- [ ] Close PagerDuty incident
- [ ] Update status page
- [ ] Notify stakeholders
- [ ] Create incident ticket in Jira

### Short-term (< 24 hours)

- [ ] Document incident timeline
- [ ] Identify root cause
- [ ] Create action items
- [ ] Update runbooks
- [ ] Schedule post-mortem (for SEV-2+)

### Post-Mortem (< 5 business days)

- [ ] Conduct blameless post-mortem meeting
- [ ] Document lessons learned
- [ ] Create preventive action items
- [ ] Update monitoring and alerting
- [ ] Share findings with team

## On-Call Best Practices

### Before Your Shift

- [ ] Review recent incidents and resolutions
- [ ] Check upcoming deployments
- [ ] Test PagerDuty notifications
- [ ] Ensure laptop and phone charged
- [ ] Review runbooks and access

### During Your Shift

- [ ] Keep laptop and phone nearby
- [ ] Respond to alerts within 5 minutes
- [ ] Document all actions taken
- [ ] Communicate proactively
- [ ] Ask for help when needed

### After Your Shift

- [ ] Conduct handoff with next on-call
- [ ] Document any ongoing issues
- [ ] Share lessons learned
- [ ] Update runbooks if needed
- [ ] Provide feedback on alerts

## Handoff Template

```
**On-Call Handoff** (YYYY-MM-DD)

**Incidents This Week**:
- SEV-2: High error rate on 11/15, resolved by rollback (2 hours)
- SEV-1: Search latency spike on 11/17, resolved by Typesense restart (30 min)

**Ongoing Issues**:
- Monitoring: False positive alerts for Lambda cold starts (ticket #1234)
- Deployments: Staging environment occasionally slow (investigating)

**Upcoming**:
- Deployment: v1.3.0 scheduled for 11/20 at 2 PM PT
- Maintenance: Database upgrade planned for 11/22 (maintenance window)

**Notes**:
- New runbook for search indexer added to ops/runbooks/
- Stripe webhook secret rotated on 11/16 (no issues)

**Questions?**: Slack me @previous-oncall
```

## Mental Health and Well-being

On-call can be stressful. Remember:

- **It's okay to escalate**: Don't try to solve everything alone
- **Take breaks**: Step away between incidents
- **Ask questions**: No question is too basic
- **Learn from incidents**: Every incident is a learning opportunity
- **Debrief**: Talk to your manager if on-call is affecting your well-being

## References

- Incident Response: `ops/runbooks/incident_response.md`
- Deployment: `ops/runbooks/deployment.md`
- Rollback: `ops/runbooks/rollback.md`
- Troubleshooting: `ops/runbooks/troubleshooting.md`

## Contacts

- **On-Call Schedule**: https://rastup.pagerduty.com/schedules
- **Engineering Manager**: @eng-manager (Slack)
- **CTO**: @cto (Slack, phone for SEV-3+)
- **HR/Support**: @people-ops (for on-call issues)

---

**Remember**: You're not expected to know everything. Escalate early and often. We're a team.
