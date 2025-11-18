# Troubleshooting Runbook

**Owner:** Engineering  
**Last Updated:** 2025-11-18  
**Applies to:** All production services

---

## Overview

This runbook provides detailed troubleshooting procedures for common production issues, organized by symptom and service.

## General Troubleshooting Approach

1. **Gather Information**: Metrics, logs, traces, recent changes
2. **Form Hypothesis**: What could cause this symptom?
3. **Test Hypothesis**: Check evidence for/against
4. **Mitigate**: Apply fix or workaround
5. **Validate**: Confirm issue resolved
6. **Document**: Record findings and solution

## Troubleshooting by Symptom

### High Error Rate

#### Symptoms
- Error rate > 0.5% above baseline
- Sentry showing new error types
- User reports of failures

#### Investigation Steps

```bash
# 1. Check error breakdown
npm run metrics:errors -- --window=15m --group-by=endpoint,status_code

# 2. Check recent deployments
npm run deploy:history -- --limit=5

# 3. Check error details in Sentry
open https://sentry.io/rastup/production

# 4. Check logs for error patterns
aws logs tail /aws/ecs/rastup-prod/api-service --follow --filter-pattern="ERROR"

# 5. Check external service status
npm run status:external-services
```

#### Common Causes and Solutions

**1. Recent Deployment Bug**
- **Evidence**: Errors started after deployment
- **Solution**: Rollback deployment
```bash
npm run deploy:rollback -- --service=api --to-version=<previous>
```

**2. External Service Down**
- **Evidence**: Errors related to Stripe, Twilio, etc.
- **Solution**: Check service status, implement fallback
```bash
# Check Stripe status
curl https://status.stripe.com/api/v2/status.json

# Disable feature temporarily
npm run flags:disable -- --flag=stripe_payments_enabled
```

**3. Database Connection Issues**
- **Evidence**: Connection timeout errors
- **Solution**: Check connection pool, scale database
```bash
# Check active connections
psql -h <db-host> -U admin -d rastup -c "
  SELECT count(*), state FROM pg_stat_activity GROUP BY state;
"

# Increase connection pool
npm run config:update -- --key=db.pool.max --value=50
```

**4. Rate Limiting**
- **Evidence**: 429 status codes
- **Solution**: Adjust rate limits or scale up
```bash
# Check rate limit metrics
npm run metrics:rate-limits -- --window=15m

# Increase rate limits temporarily
npm run config:update -- --key=rate_limit.requests_per_minute --value=1000
```

### High Latency

#### Symptoms
- p95 latency > 25% above baseline
- User reports of slow page loads
- APM showing slow traces

#### Investigation Steps

```bash
# 1. Check latency breakdown
npm run metrics:latency -- --window=15m --percentiles=50,95,99 --group-by=endpoint

# 2. Check APM traces
open https://datadog.rastup.com/apm/traces?env=production&sort=duration

# 3. Check database query performance
npm run db:slow-queries -- --threshold=1000ms --limit=20

# 4. Check external service latency
npm run metrics:external-services -- --window=15m --metric=latency

# 5. Check resource utilization
npm run metrics:infra -- --services=api,search,messaging --metrics=cpu,memory
```

#### Common Causes and Solutions

**1. Slow Database Queries**
- **Evidence**: APM traces show database time > 50% of request time
- **Solution**: Optimize queries, add indexes
```bash
# Find slow queries
psql -h <db-host> -U admin -d rastup -c "
  SELECT query, mean_exec_time, calls 
  FROM pg_stat_statements 
  ORDER BY mean_exec_time DESC 
  LIMIT 20;
"

# Explain query plan
psql -h <db-host> -U admin -d rastup -c "
  EXPLAIN ANALYZE <slow-query>;
"

# Add missing index (if identified)
psql -h <db-host> -U admin -d rastup -c "
  CREATE INDEX CONCURRENTLY idx_users_city ON users(city);
"
```

**2. N+1 Query Problem**
- **Evidence**: Many small database queries per request
- **Solution**: Use DataLoader or eager loading
```bash
# Check query count per request
npm run metrics:db-queries -- --window=15m --group-by=endpoint

# Enable query logging temporarily
npm run config:update -- --key=db.log_queries --value=true
```

**3. External Service Latency**
- **Evidence**: APM traces show external API calls taking long
- **Solution**: Implement caching, timeouts, circuit breakers
```bash
# Check external service latency
npm run metrics:external-services -- --window=15m

# Enable caching for external API
npm run flags:enable -- --flag=stripe_api_cache_enabled

# Reduce timeout
npm run config:update -- --key=stripe.timeout_ms --value=5000
```

**4. High CPU/Memory Usage**
- **Evidence**: Resource utilization > 80%
- **Solution**: Scale up or optimize code
```bash
# Check resource utilization
aws ecs describe-services --cluster rastup-prod --services api-service

# Scale up temporarily
aws ecs update-service \
  --cluster rastup-prod \
  --service api-service \
  --desired-count 10

# Check for memory leaks
npm run metrics:memory -- --window=1h --group-by=task
```

### Service Unavailable

#### Symptoms
- 503 Service Unavailable errors
- Health check failing
- Service not responding

#### Investigation Steps

```bash
# 1. Check service status
aws ecs describe-services --cluster rastup-prod --services api-service

# 2. Check task health
aws ecs list-tasks --cluster rastup-prod --service-name api-service --desired-status RUNNING

# 3. Check task details
aws ecs describe-tasks --cluster rastup-prod --tasks <task-arn>

# 4. Check logs
aws logs tail /aws/ecs/rastup-prod/api-service --follow

# 5. Check dependencies
curl https://api.rastup.com/ready
```

#### Common Causes and Solutions

**1. Service Crashed**
- **Evidence**: No running tasks or tasks in STOPPED state
- **Solution**: Check logs for crash reason, restart service
```bash
# Check stopped tasks
aws ecs list-tasks --cluster rastup-prod --service-name api-service --desired-status STOPPED

# Check task exit reason
aws ecs describe-tasks --cluster rastup-prod --tasks <stopped-task-arn> --query 'tasks[0].stoppedReason'

# Common reasons:
# - OutOfMemory: Increase memory limit
# - Essential container exited: Check logs for error
# - Health check failed: Check health endpoint

# Restart service
aws ecs update-service \
  --cluster rastup-prod \
  --service api-service \
  --force-new-deployment
```

**2. Deployment Stuck**
- **Evidence**: Service events show deployment in progress for > 30 minutes
- **Solution**: Check deployment status, rollback if needed
```bash
# Check deployment status
aws ecs describe-services --cluster rastup-prod --services api-service --query 'services[0].deployments'

# Check service events
aws ecs describe-services --cluster rastup-prod --services api-service --query 'services[0].events[0:10]'

# Rollback if stuck
npm run deploy:rollback -- --service=api --to-version=<previous>
```

**3. Database Unreachable**
- **Evidence**: Ready endpoint shows database unhealthy
- **Solution**: Check database status, connectivity
```bash
# Check database status
aws rds describe-db-instances --db-instance-identifier rastup-prod

# Test connectivity
psql -h <db-host> -U admin -d rastup -c "SELECT 1;"

# Check security groups
aws ec2 describe-security-groups --group-ids <db-security-group-id>
```

**4. Resource Exhaustion**
- **Evidence**: Tasks failing to start, resource allocation errors
- **Solution**: Scale cluster or reduce resource requirements
```bash
# Check cluster capacity
aws ecs describe-clusters --clusters rastup-prod

# Check container instance availability
aws ecs list-container-instances --cluster rastup-prod

# Scale cluster (if using EC2)
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name rastup-prod-cluster \
  --desired-capacity 10
```

## Troubleshooting by Service

### API Service

#### Health Check Failing

```bash
# Check health endpoint
curl -v https://api.rastup.com/health

# Check ready endpoint (includes dependencies)
curl -v https://api.rastup.com/ready

# Common issues:
# - Database connection: Check connection pool
# - Redis connection: Check Redis status
# - External service: Check service status

# Check logs for health check errors
aws logs tail /aws/ecs/rastup-prod/api-service --follow --filter-pattern="health"
```

#### GraphQL Errors

```bash
# Check GraphQL error rate
npm run metrics:graphql -- --window=15m --group-by=operation,error_type

# Check slow GraphQL operations
npm run metrics:graphql -- --window=15m --sort-by=duration --limit=20

# Enable GraphQL query logging
npm run config:update -- --key=graphql.log_queries --value=true

# Check for N+1 queries
npm run metrics:graphql -- --window=15m --metric=db_queries_per_operation
```

### Search Service

#### Search Not Returning Results

```bash
# Check Typesense health
curl https://typesense.rastup.com/health

# Check collection stats
curl -H "X-TYPESENSE-API-KEY: $API_KEY" \
  https://typesense.rastup.com/collections/models

# Check outbox backlog
psql -h <db-host> -U admin -d rastup -c "
  SELECT count(*), processed FROM search.outbox GROUP BY processed;
"

# Check indexer logs
aws logs tail /aws/lambda/rastup-search-indexer --follow

# Trigger reindex if needed
npm run search:reindex -- --surface=models --city=los-angeles --dry-run
```

#### Search Latency High

```bash
# Check Typesense latency
npm run metrics:typesense -- --window=15m --metric=latency

# Check cache hit rate
npm run metrics:search -- --window=15m --metric=cache_hit_rate

# Check query complexity
npm run metrics:search -- --window=15m --group-by=filters,facets

# Enable OpenSearch fallback if needed
npm run flags:update -- --flag=search.engine --value=OPENSEARCH
```

### Database

#### Connection Pool Exhausted

```bash
# Check active connections
psql -h <db-host> -U admin -d rastup -c "
  SELECT count(*), state, application_name 
  FROM pg_stat_activity 
  GROUP BY state, application_name;
"

# Check connection pool settings
npm run config:get -- --key=db.pool

# Increase pool size temporarily
npm run config:update -- --key=db.pool.max --value=50

# Kill idle connections (if needed)
psql -h <db-host> -U admin -d rastup -c "
  SELECT pg_terminate_backend(pid) 
  FROM pg_stat_activity 
  WHERE state = 'idle' 
    AND state_change < now() - interval '10 minutes';
"
```

#### Lock Contention

```bash
# Check locks
psql -h <db-host> -U admin -d rastup -c "
  SELECT 
    l.pid, 
    l.mode, 
    l.granted, 
    a.query, 
    a.state,
    now() - a.query_start AS duration
  FROM pg_locks l
  JOIN pg_stat_activity a ON l.pid = a.pid
  WHERE NOT l.granted
  ORDER BY duration DESC;
"

# Check blocking queries
psql -h <db-host> -U admin -d rastup -c "
  SELECT 
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking.query AS blocking_query
  FROM pg_stat_activity blocked
  JOIN pg_locks blocked_locks ON blocked.pid = blocked_locks.pid
  JOIN pg_locks blocking_locks ON blocked_locks.locktype = blocking_locks.locktype
  JOIN pg_stat_activity blocking ON blocking_locks.pid = blocking.pid
  WHERE NOT blocked_locks.granted AND blocking_locks.granted;
"

# Kill blocking query (if needed)
psql -h <db-host> -U admin -d rastup -c "
  SELECT pg_terminate_backend(<blocking_pid>);
"
```

#### Replication Lag

```bash
# Check replication status
psql -h <db-host> -U admin -d rastup -c "
  SELECT 
    client_addr,
    state,
    sync_state,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes
  FROM pg_stat_replication;
"

# Check replica lag time
aws rds describe-db-instances \
  --db-instance-identifier rastup-prod-replica \
  --query 'DBInstances[0].StatusInfos'

# If lag too high:
# - Check replica instance size
# - Check network connectivity
# - Consider scaling up replica
```

### Payment Service

#### Stripe Webhook Failures

```bash
# Check webhook logs
npm run logs:webhooks -- --source=stripe --window=1h

# Check webhook signature validation
aws logs tail /aws/ecs/rastup-prod/payment-service --follow --filter-pattern="webhook signature"

# Check Stripe dashboard
open https://dashboard.stripe.com/webhooks

# Retry failed webhooks
npm run webhooks:retry -- --source=stripe --since=1h

# Rotate webhook secret if needed
npm run secrets:rotate -- --secret=stripe_webhook_secret
```

#### Payment Intent Failures

```bash
# Check payment intent errors
npm run metrics:payments -- --window=1h --group-by=error_code

# Check Stripe API errors
aws logs tail /aws/ecs/rastup-prod/payment-service --follow --filter-pattern="stripe api error"

# Common errors:
# - card_declined: User issue, notify user
# - insufficient_funds: User issue, notify user
# - authentication_required: Requires 3D Secure, handle in UI
# - api_error: Stripe issue, retry with backoff

# Check Stripe status
curl https://status.stripe.com/api/v2/status.json
```

### Messaging Service

#### WebSocket Connection Issues

```bash
# Check WebSocket connections
npm run metrics:websocket -- --window=15m --metric=active_connections

# Check connection errors
aws logs tail /aws/ecs/rastup-prod/websocket-service --follow --filter-pattern="connection error"

# Check load balancer health
aws elbv2 describe-target-health \
  --target-group-arn <websocket-target-group-arn>

# Common issues:
# - Connection timeout: Check idle timeout settings
# - Authentication failure: Check JWT validation
# - Too many connections: Scale up service
```

#### Message Delivery Delays

```bash
# Check message queue backlog
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789/rastup-messages \
  --attribute-names ApproximateNumberOfMessages,ApproximateAgeOfOldestMessage

# Check message processing rate
npm run metrics:messages -- --window=15m --metric=processing_rate

# Check notification service logs
aws logs tail /aws/ecs/rastup-prod/notification-service --follow

# Scale up message processors if needed
aws lambda update-function-configuration \
  --function-name rastup-message-processor \
  --reserved-concurrent-executions 100
```

## Performance Profiling

### CPU Profiling

```bash
# Enable CPU profiling
npm run profile:cpu -- --service=api --duration=60s

# Download profile
npm run profile:download -- --service=api --type=cpu --output=cpu-profile.cpuprofile

# Analyze with Chrome DevTools
# Open chrome://inspect, load profile
```

### Memory Profiling

```bash
# Take heap snapshot
npm run profile:heap -- --service=api

# Download snapshot
npm run profile:download -- --service=api --type=heap --output=heap-snapshot.heapsnapshot

# Analyze with Chrome DevTools
# Open chrome://inspect, load snapshot
```

### Database Query Profiling

```bash
# Enable query logging
psql -h <db-host> -U admin -d rastup -c "
  ALTER SYSTEM SET log_min_duration_statement = 1000;
  SELECT pg_reload_conf();
"

# Check slow queries
psql -h <db-host> -U admin -d rastup -c "
  SELECT query, mean_exec_time, calls, total_exec_time
  FROM pg_stat_statements
  ORDER BY mean_exec_time DESC
  LIMIT 20;
"

# Reset stats (after analysis)
psql -h <db-host> -U admin -d rastup -c "
  SELECT pg_stat_statements_reset();
"
```

## References

- On-Call Runbook: `ops/runbooks/on-call.md`
- Incident Response: `ops/runbooks/incident_response.md`
- Deployment: `ops/runbooks/deployment.md`
- Rollback: `ops/runbooks/rollback.md`

## Contacts

- **On-Call Engineer**: PagerDuty
- **Database Administrator**: @dba (Slack)
- **Security Engineer**: @security (Slack)
- **Engineering Manager**: @eng-manager (Slack)
