# WAF, Bot Control & Rate Limiting

## Objectives

- Shield public endpoints from automated abuse, credential stuffing, and scraping.
- Provide clear configuration, monitoring, and emergency controls for WAF rules.

## Architecture

- **AWS WAF** attached to CloudFront distribution and API Gateway.
- **AWS Bot Control** enabled with JavaScript challenge for suspicious requests.
- **IP reputation lists:** hourly sync from commercial threat intel + internal ban list (`WAF_IP_SET_ID`).
- **Rate limit rules:**
  - Search: 1200 req/5 min per IP (tightened via `search-rate-limit-tighten` flag).
  - Auth endpoints: 50 req/5 min per IP + per-credential velocity rules.
  - Messaging: 300 req/5 min per session to prevent spam.

## Rule Set

| Rule Name | Priority | Action | Notes |
| --- | --- | --- | --- |
| `aws-common` | 1 | block | Managed rule set (SQLi/XSS/lfi). |
| `botcontrol-js` | 5 | challenge | Enables Bot Control JS for anomalies. |
| `credential-stuffing` | 10 | block | Detects repeated failed auth from same IP/device fingerprint. |
| `scraper-rate-limit` | 20 | block | Applies 1200 req/5 min limit; returns 429 with Retry-After. |
| `graphql-depth` | 30 | block | Custom Lambda@Edge rejects >10 nested selections. |
| `geo-restriction` | 40 | challenge | Requires CAPTCHA for unsupported countries. |

## Monitoring

- Metrics exported via CloudWatch to Prometheus:
  - `waf_blocked_requests_total`
  - `waf_challenged_requests_total`
  - `waf_rate_limit_hits_total`
- Alerts:
  - `waf_blocked_requests_total` spike > 5x baseline triggers SEV2 investigation.
  - Credential stuffing detection triggers automatic rotation of login session salts.
- Dashboard: `observability/dashboards/search.md` extended to include WAF panel (TODO).

## Incident Workflow

1. Review WAF metrics; confirm abuse pattern.
2. If legitimate traffic impacted:
   - Toggle `BOTCONTROL_JS_CHALLENGE` or `search-rate-limit-tighten`.
   - Update allowlist via `aws wafv2 update-ip-set`.
3. For persistent attack, enable `global-readonly` and escalate to Incident Commander (see `ops/runbooks/incident_response.md`).
4. Document mitigation in Security ticket and append summary to `docs/security/training_and_drills.md`.

## Evidence

- Monthly export of WAF logs to audit bucket with hash manifests.
- Pen test reports verify bypass attempts recorded and resolved.
- Rate limit unit tests under `tests/security/test_waf_policy.py` (added in this WBS) assert configuration contract.
