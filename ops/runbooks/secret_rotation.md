# Secret & Key Rotation Runbook

**Owner:** Security Engineering  
**Applies to:** AWS Secrets Manager, AWS KMS, Stripe webhook secret, Typesense API keys

## 1. Preconditions

- Confirm entry exists in `ops/config/registry.md` with up-to-date owner and rotation interval.
- Identify dependent services, ECS tasks, and Lambda functions that consume the secret.
- Schedule maintenance window for production rotations; for dev/stage run during business hours.

## 2. Create New Version

1. Generate replacement credential locally or via automation (e.g., AWS RDS credential rotation, `stripe login`).
2. Store new value in AWS Secrets Manager or KMS:
   - `aws secretsmanager put-secret-value --secret-id <ARN> --secret-string file://secret.json`
   - For KMS customer keys: `aws kms create-key --description "App key <YYYYMMDD>"`.
3. Tag the secret with `version=<YYYYMMDD>` and `rotated_by=<user>`.

## 3. Deploy & Validate

1. Update infrastructure configuration (CDK/Terraform/Parameter Store) to reference the new secret version or key alias.
2. Deploy application stack to dev → stage → prod, verifying health checks at each step.
3. Run smoke tests:
   - `python tools/validate_event_contracts.py --mode smoke`
   - `npm test -- security:smoke` (future placeholder)
4. Confirm no `AccessDenied` or decryption errors appear in CloudWatch metrics.

## 4. Decommission Old Material

1. For Secrets Manager, mark older versions as deprecated: `aws secretsmanager update-secret-version-stage --remove-from-version-stage AWSCURRENT`.
2. For KMS keys:
   - Update alias to new key: `aws kms update-alias --alias-name alias/app --target-key-id <new-key-id>`.
   - Schedule deletion for old key after 30 days: `aws kms schedule-key-deletion`.
3. For Stripe webhooks, click “Rotate secret” in dashboard and redeploy processors before removing old secret.
4. Document completion in audit log (see Section 6).

## 5. Rollback Plan

- Retain prior secret version for 48 hours.
- Re-point alias/rotation stage to previous version if new deployment fails.
- Re-run smoke tests after rollback and open incident ticket referencing SEV level.

## 6. Evidence & Logging

- Record the following in the immutable audit log stream:
  - Secret/key identifier
  - Approval ticket (JIRA/SOC2 reference)
  - Operator & timestamp
  - Validation results
- Upload supporting evidence (CLI output, screenshots) to `s3://rastup-audit-prod/rotations/<YYYY>/<MM>/<secret>` with Object Lock.

## 7. Escalation Matrix

- **Primary on-call:** Security Engineer
- **Secondary:** Platform SRE
- **Compliance liaison:** Privacy Counsel (for DSAR signing key rotations)

## 8. Checklist

- [ ] New secret or key created
- [ ] Configuration deployed across environments
- [ ] Smoke tests executed
- [ ] Previous secret revoked/scheduled for deletion
- [ ] Audit evidence uploaded
- [ ] Runbook ticket closed with summary
