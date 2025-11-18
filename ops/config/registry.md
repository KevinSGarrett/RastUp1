# Configuration & Secrets Registry

Authoritative list of environment configuration, secrets locations, and rotation requirements across services and stages. Changes require pull request approval and coordinated updates to deployment automation.

| Key | Service | Env | Type | Default | Allowed Values | Secret Store | Owner | Rotation | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `APP_ENV` | web, api | all | enum | `dev` | `dev`, `stage`, `prod` | plain | Platform | n/a | Controls feature toggles and telemetry sampling guardrails. |
| `GRAPHQL_URL` | web | dev, stage | url | stage endpoint | HTTPS endpoint per env | plain | Platform | n/a | Must use TLS 1.2+. Hard-coded to production CDN in prod deployments. |
| `JWT_AUDIENCE` | api | all | string | `rastup-app` | fixed | plain | Security | n/a | All auth tokens validated against this audience. |
| `DB_SECRET_ARN` | api | stage, prod | arn | — | must exist | Secrets Manager | Security | 90d | Aurora credentials; rotation run via `ops/runbooks/secret_rotation.md`. |
| `KMS_KEY_APP` | api | prod | arn | — | must exist | KMS | Security | annual | Primary envelope key for application secrets and DSAR exports. |
| `KMS_KEY_AUDIT_LOG` | logging | prod | arn | — | must exist | KMS | Security | annual | Dedicated key for immutable audit log bucket; rotation with chained hash re-key procedure. |
| `STRIPE_SECRET_KEY` | api | stage, prod | secret | — | must exist | Secrets Manager | Finance | on-demand | Rotate immediately on key exposure; PCI scope limited to Stripe tokens. |
| `STRIPE_WEBHOOK_SECRET` | api | stage, prod | secret | — | must exist | Secrets Manager | Finance | on-demand | Used to validate Stripe Connect webhooks; stored encrypted. |
| `WAF_IP_SET_ID` | edge | prod | string | — | UUID | Parameter Store | Security | 90d review | Managed IP allow/block list supporting WAF anomaly detection. |
| `WAF_RATE_LIMIT` | edge | prod | int | 1200 | ≥ 600 & ≤ 3000 | Parameter Store | Security | quarterly | Requests per 5 min window before BotControl challenge. |
| `BOTCONTROL_JS_CHALLENGE` | edge | prod | bool | `true` | `true`, `false` | Parameter Store | Security | n/a | Enables AWS Bot Control JavaScript challenge on high-risk routes. |
| `AUDIT_LOG_BUCKET` | logging | prod | string | `rastup-audit-prod` | S3 bucket name | plain | Security | n/a | Versioned + Object Lock (governance). |
| `AUDIT_LOG_CHAIN_SALT` | logging | prod | secret | — | must exist | Secrets Manager | Security | 180d | Salt used in per-entry SHA-256 hashing of audit log chain. |
| `LEGAL_HOLD_VAULT` | compliance | prod | string | `rastup-legal-hold` | S3 bucket name | plain | Legal | n/a | WORM storage with access via legal hold workflow. |
| `DSAR_EXPORT_BUCKET` | compliance | stage, prod | string | `rastup-dsar` | S3 bucket | plain | Privacy | n/a | Output target for DSAR zip exports; lifecycle policy 30 days. |
| `DSAR_SIGNING_KEY_ARN` | compliance | prod | arn | — | must exist | KMS | Privacy | annual | Signs DSAR export manifests for tamper evidence. |
| `SAFE_MODE_DEFAULT` | web, api | all | bool | `true` | `true`, `false` | plain | Safety | n/a | Ensures NSFW filtering defaults on for anonymous traffic. |
| `RBAC_JIT_ROLE_ARN` | platform | prod | arn | — | must exist | IAM | Security | n/a | Assumed via Access Manager for just-in-time elevation. |
| `MFA_ENFORCED` | platform | prod | bool | `true` | `true`, `false` | plain | Security | n/a | Enforces hardware MFA for privileged IAM groups. |
| `SECURITY_CONTACT_EMAIL` | platform | all | email | `security@rastup.com` | RFC 5322 | plain | Security | n/a | Used for automated alerts, trust center contact, and vendor questionnaires. |
| `TRAINING_PORTAL_URL` | compliance | all | url | `https://training.rastup.com` | HTTPS only | plain | People Ops | annual review | Hosts annual security & privacy training modules. |

## Change Control

- Registry lives in Git; CI rejects unknown `process.env` keys unless registered.
- Updates require approval from Security and owning team; production secrets rotate using the runbook in `ops/runbooks/secret_rotation.md`.
- Secrets are provisioned through Terraform/CDK and fetched at runtime via AWS SDK with IAM conditions restricting source VPC and role.

## Audit & Evidence

- Quarterly review exports registry snapshot to `docs/compliance/registry-<YYYYMM>.pdf`.
- Access logs for Secrets Manager, KMS, and Parameter Store are forwarded to the audit log pipeline documented in `observability/log_schema.md`.
