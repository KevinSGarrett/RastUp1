# PCI DSS Compliance Posture

## Scope

- Stripe Connect serves as the payment processor; no raw PAN data stored or transmitted by RastUp systems.
- SAQ-A applies because cardholder data environment is outsourced; focus remains on secure integration, webhook handling, and evidence collection.

## Controls

- **Tokenization:** All card interactions occur via Stripe Elements/PaymentIntents; application receives tokens only.
- **Secure Webhooks:**
  - Secrets stored in AWS Secrets Manager (`STRIPE_WEBHOOK_SECRET`).
  - Webhook signature verification enforced; retries handled idempotently.
- **Payout Security:**
  - MFA required for changing payout destinations (Stripe Dashboard + Access Manager role).
  - Velocity limits for new hosts’ payouts (first 30 days).
- **Network Segmentation:**
  - Payment webhooks isolated in VPC subnet with least-privilege security groups.
  - Outbound egress restricted to Stripe endpoints.
- **Logging & Monitoring:**
  - Payment events duplicated into audit log stream with sanitized payloads.
  - Real-time alerts on payout destination changes, high dispute rates.
- **Policies & Training:**
  - Annual PCI awareness training recorded in `docs/security/training_and_drills.md`.
  - Incident response runbook includes PCI-specific comms protocol (see `ops/runbooks/incident_response.md`).

## Evidence Checklist

- [ ] Stripe attestation of compliance (AOC) stored in compliance repository.
- [ ] Quarterly ASV scans (attested by provider) with remediation tracking.
- [ ] Web application firewall coverage documented in `docs/security/waf_bot_control.md`.
- [ ] Change management tickets for payment code reviewed and approved.
- [ ] Access reviews confirming restricted staff list for payment dashboards.

## Testing

- Unit tests (see `tests/security/test_pci_controls.py`) verify configuration metadata for Stripe integration.
- Pen tests validate webhook endpoint resilience and absence of card data leakage.

## Future Enhancements

- Evaluate Stripe Financial Connections/ACH readiness (Phase 2).
- Implement continuous compliance monitoring via Drata/StrikeGraph integration.
