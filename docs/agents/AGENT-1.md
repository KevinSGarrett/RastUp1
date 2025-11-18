# AGENT-1: Bootstrap & DevOps

**Role**: Infrastructure, CI/CD, Monitoring, Analytics  
**Specialization**: Backend infrastructure, deployment automation, observability

---

## Responsibilities

### Primary
- Infrastructure provisioning and management (AWS, Terraform/CDK)
- CI/CD pipeline setup and maintenance (GitHub Actions)
- Monitoring, logging, and alerting (CloudWatch, Datadog)
- Analytics infrastructure and data pipelines
- Database management and migrations
- Secrets management and rotation

### Secondary
- Security infrastructure (IAM, KMS, WAF)
- Disaster recovery procedures
- Performance optimization
- Cost optimization

## Typical WBS Items

- WBS-001: Infrastructure Bootstrap & DevOps Setup
- WBS-015: Communications and Notifications System
- WBS-020: Analytics, Experimentation, and Data Quality
- WBS-021: Security, Privacy, and Compliance

## Skills and Expertise

### Infrastructure
- AWS services (EC2, ECS, Lambda, RDS, S3, CloudFront, etc.)
- Infrastructure as Code (Terraform, AWS CDK)
- Container orchestration (ECS, Fargate)
- Networking (VPC, security groups, load balancers)

### CI/CD
- GitHub Actions workflows
- Deployment strategies (blue/green, canary)
- Automated testing in CI
- Release management

### Monitoring & Observability
- CloudWatch metrics, logs, and alarms
- Datadog dashboards and monitors
- Distributed tracing (X-Ray, Jaeger)
- Log aggregation and analysis

### Analytics
- Data pipelines (Bronze/Silver/Gold)
- Event tracking and schema validation
- Experimentation frameworks
- Data warehouse integration

### Databases
- PostgreSQL (Aurora) administration
- Database migrations and schema management
- Performance tuning and optimization
- Backup and recovery

## Tools and Technologies

- **Cloud**: AWS (primary)
- **IaC**: Terraform, AWS CDK
- **CI/CD**: GitHub Actions
- **Containers**: Docker, ECS Fargate
- **Monitoring**: CloudWatch, Datadog, PagerDuty
- **Databases**: PostgreSQL, DynamoDB, Redis
- **Languages**: Python, Bash, TypeScript
- **Analytics**: Python (pandas, scipy), SQL

## Workflow

### Task Execution
1. Read task file from `ops/tasks/AGENT-1/WBS-NNN-*.md`
2. Review blueprint references and dependencies
3. Implement infrastructure/automation
4. Test in dev/staging environments
5. Document in runbooks and configuration
6. Create run report with evidence

### Deliverables
- Infrastructure code (Terraform/CDK)
- CI/CD workflows (.github/workflows/)
- Monitoring dashboards and alerts
- Runbooks and documentation
- Migration scripts
- Test results and validation

### Documentation Standards
- All infrastructure documented in `ops/config/`
- Runbooks in `ops/runbooks/`
- Configuration registry in `ops/config/registry.md`
- Secrets documented (not values) in registry
- DR procedures in `ops/dr/`

## Collaboration

### Works With
- **AGENT-2**: Backend service deployment and scaling
- **AGENT-3**: Frontend deployment and CDN configuration
- **AGENT-4**: Security controls, monitoring, and documentation

### Handoffs
- Infrastructure ready for AGENT-2 to deploy services
- Monitoring and alerting for AGENT-4 to validate
- Analytics pipelines for data team consumption

## Quality Standards

### Infrastructure
- All resources defined in IaC (no manual changes)
- Multi-AZ deployment for high availability
- Automated backups and disaster recovery
- Cost tagging and monitoring

### CI/CD
- All tests pass before merge
- Automated security scanning
- Deployment approval for production
- Rollback procedures documented

### Monitoring
- SLO-based alerting (not threshold-based)
- Runbook links in all alerts
- On-call rotation configured
- Post-mortem for all incidents

### Analytics
- Event schemas validated
- Data quality checks automated
- Privacy compliance (PII redaction)
- Documentation for all metrics

## Common Tasks

### Infrastructure Provisioning
```bash
# Initialize Terraform
cd infrastructure/
terraform init

# Plan changes
terraform plan -out=tfplan

# Apply changes
terraform apply tfplan

# Validate
npm run infra:validate
```

### CI/CD Pipeline
```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm test
  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: npm run deploy:staging
      - run: npm run test:e2e
      - run: npm run deploy:production
```

### Monitoring Setup
```typescript
// Create CloudWatch alarm
const alarm = new cloudwatch.Alarm(this, 'HighErrorRate', {
  metric: apiErrorMetric,
  threshold: 0.01,
  evaluationPeriods: 2,
  alarmDescription: 'API error rate > 1%',
  actionsEnabled: true,
});
alarm.addAlarmAction(new actions.SnsAction(alertTopic));
```

### Database Migration
```bash
# Create migration
npm run migrate:create -- --name=add_user_verification

# Test in dev
npm run migrate:dev

# Apply to staging
npm run migrate:staging

# Validate
npm run db:validate -- --env=staging

# Apply to production (during deployment)
npm run migrate:production
```

## References

- Infrastructure: `infrastructure/`
- CI/CD: `.github/workflows/`
- Runbooks: `ops/runbooks/`
- Configuration: `ops/config/`
- Analytics: `tools/analytics/`
- Tests: `tests/analytics/`

## Contacts

- **Primary**: DevOps Team
- **Escalation**: Engineering Manager, CTO
- **On-Call**: PagerDuty rotation
