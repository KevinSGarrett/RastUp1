# Infrastructure Bootstrap Roadmap — WBS-001

## Context

- **Owner:** AGENT-1 (Bootstrap & DevOps)
- **Blueprint references:** TD-0062 – TD-0114 (Amplify Gen 2, multi-account, security, observability, cost, DR, DX)
- **Environments:** `rastup-dev`, `rastup-stage`, `rastup-prod` (primary region `us-east-1`)
- **Stacks in scope:** Auth, API, Data, Search, Media, Workflow, Observability, Comms, Admin
- **Related work packages:** WP-INF-01/02/03 (Infra/IaC), WP-DATA-02 (Search), WP-SEC-01 (WAF & Secrets), WP-OBS-01 (Observability)

## Account & Environment Matrix

| Account | Purpose | Branch mapping | AWS Budgets (USD) | Notes |
|---------|---------|----------------|-------------------|-------|
| `rastup-dev` | Feature development, integration tests, ephemeral previews | `develop`, `feature/*` previews (auto-destroy 48h) | 2,500 | Lower guardrails; allow experimental flags; isolate Secrets Manager usage |
| `rastup-stage` | Pre-prod smoke, DR drills, release validation | `main` (auto deploy) | 6,000 | Mirrors prod topology; enables DR restore drills & WAF canary rules |
| `rastup-prod` | Live customer traffic | `release/*` (manual promote) | 20,000 | Finance-controlled approvals; AppConfig flags default-off |

### Shared guardrails

- AWS Organizations with SCPs preventing legacy Amplify Classic artefacts, public RDS, or wildcard IAM.
- Central KMS key policy template with per-account grants.
- CI enforces `cdk diff` + `infracost` check; merges blocked on cost deltas \>10%.

## Amplify Gen 2 & CDK Structure

```
amplify/
  stack.ts                 # Amplify app entrypoint
  backend/
    auth/                  # Cognito
    api/                   # AppSync schema + resolvers
    data/                  # Aurora + Dynamo constructs
    media/                 # S3, CloudFront, Lambda@Edge
    workflow/              # SQS, EventBridge, StepFunctions
    search/                # Typesense/OpenSearch toggle
    observability/         # Dashboards, alarms, logs
    comms/                 # SES/SNS mail pipelines
    admin/                 # Amplify Admin UI & RBAC seeds
cdk/
  bin/infra.ts             # Non-Amplify bootstrap (Organizations, IAM)
  lib/
    org-stack.ts           # Multi-account org bootstrap
    budgets-stack.ts       # Budgets + SNS notifications
    identity-stack.ts      # SSO, break-glass, audit trail
```

**Guardrails**

- Repository hooks reject `amplify/cli.json` or `team-provider-info.json`.
- `pnpm cdk:nag` stage runs `cdk-nag` with security packs; failure blocks pipeline.
- `tools/infra/preflight.py` (to build) validates SSM parameters, Secrets Manager rotations, AppConfig flag schema.

## Security Baseline Tasks

- **IAM:** Generate least-privilege role matrix per stack (`docs/security/iam_and_kms.md` appendix) and codify with CDK constructs.
- **WAF & Shield:** Layered rules — AWS managed core, rate limiting per path (`/auth`, `/api`, `/checkout`), custom allowlists/denylists synced from AppConfig.
- **TLS:** ACM certificates per environment, auto-renew, certificate validation via Route53.
- **Secrets:** AWS Secrets Manager for DB credentials, API keys; enforce rotation lambda templates; map to AppConfig feature flags for toggles.
- **KMS:** CMKs for RDS, Dynamo, S3, Typesense volumes; rotation cadence logged in `tools/infra/rotation-report.py` (future).

## CI/CD Pipeline Overview

| Stage | Trigger | Actions | Blocking Checks |
|-------|---------|---------|-----------------|
| `lint` | PR open/update | `pnpm lint`, `pnpm typecheck` | ESLint, tsc |
| `unit` | Parallel to lint | `pnpm test`, `python -m unittest`, contract tests | Coverage ≥80% |
| `infra` | After unit | `pnpm cdk:diff`, `pnpm amplify:status`, `pnpm cdk:nag` | Fail on drift or nag violations |
| `cost` | After infra | `infracost breakdown` vs baseline | Require finance approval if delta \>10% |
| `deploy-dev` | merge to `develop` | CDK deploy to `rastup-dev`, run smoke tests | Rollback automation on failure |
| `deploy-stage` | merge to `main` | Promote artefacts, run DR drill smoke | Notify SecOps |
| `deploy-prod` | tag `release/*` | Manual approval → deploy → post-deploy checks | Runbook RB-Z |

Branch protection rules enforce status checks, signed commits, change management tags (security, migration, cost).

- Local guardrails: `make ci` now invokes `infra-preflight` and `infra-smoke` targets, blocking merges if registry, feature flag, runbook, or rotation checks fail.

## Observability Foundation

- CloudWatch dashboards: `Latency`, `ErrorRate`, `QueueDepth`, `Spend`.
- Log ingestion via Firehose → S3 → Athena table `infra_logs`; PII scrubbed (per `observability/redaction_policy.md`).
- X-Ray tracing enabled across AppSync → Lambda → RDS; propagate `x-trace-id` header from CloudFront.
- Alerts: SLO burn rates, WAF anomaly detection, Aurora ACU thrash, Typesense OCU usage, SES bounce spikes.
- Runbook alignment: `ops/runbooks/incident_response.md`, `RB-N-01_regional_failover.md`, `RB-Z-incident_template.md`.

## Cost Controls

- Baseline budgets (per account) sending to `#finops-alerts` SNS/email.
- Lifecycle rules: S3 to Intelligent-Tiering after 30 days, Glacier at 180.
- NAT egress alarms using VPC Flow logs \+ CloudWatch Anomaly detection.
- Typesense OCU cap; auto scale down on sustained idle.
- CI `cost bump` gate fails if monthly projection increases >15%; override path logged in manifest.

## Implementation Phases

1. **Org Bootstrap (Day 0)**
   - Create AWS Organizations structure, SCPs, baseline IAM identities.
   - Deploy budgets stack + cross-account logging buckets.
2. **Core Networking (Day 1–2)**
   - Shared VPC templates (dev/stage/prod variations), private/public subnets, NAT substitutes (VPC endpoints).
   - Parameterize CIDR ranges for growth.
3. **Amplify Core Stacks (Day 3–5)**
   - Auth, API, Data, Workflow stacks with minimal resources; enable `cdk-nag`.
   - Deploy dev environment, run smoke tests, validate Secrets Manager integration.
4. **Security & Observability (Day 5–7)**
   - Attach WAF to CloudFront, configure Shield Advanced (prod).
   - Deploy Observability stack (dashboards, alarms, log subscriptions).
5. **Cost & DR Hardening (Day 7–10)**
   - Infracost baseline snapshots, AppConfig flag matrix, DR drill scripts (s3-restore-list, route53 failover).
   - Stage restore rehearsal + documentation of outcomes.

Each phase must exit with CI evidence and documented runbook updates.

## Testing & Validation Plan

- **IaC static analysis:** `pnpm cdk:nag`, `cfn-lint`, `bandit` for Python helpers.
- **Deployment smoke:** automated via `tools/infra/smoke.sh` (future) verifying AppSync healthchecks, WAF sample requests, Typesense endpoints.
- **Security tests:** `aws iam access-analyzer` diff, `aws wafv2 check` simulated requests, rotation dry-runs.
- **DR drill:** restore Aurora snapshot in stage, run acceptance script verifying bookings/search seeds.
- **Cost tests:** run `infracost` scenarios for scale tiers, ensure budgets alarms configured with correct thresholds.

Test commands/scripts must be logged in run reports and stored in attach packs.

## Deliverables & Traceability

- CDK templates per stack with README cross-links into this document.
- CI pipeline definition stored under `.github/workflows/infra.yml` (future).
- Manifest of secrets, KMS keys, and AppConfig flags recorded in `ops/config/`.
- Runbooks updated with drill outcomes; attach packs include diff summaries and test logs.

## Open Risks & Follow-ups

- Missing `make ci` target; block for unified CI pipeline (carryover from WBS-021).
- Automation scripts (`tools/infra/preflight.py`, `smoke.sh`, rotation-report) placeholder — to be implemented in upcoming runs.
- Need decision on Typesense managed vs self-hosted; cost modeling pending.
- Ensure Safe Writes policy reconciles with lock-file updates for future agents (flag to Orchestrator).

