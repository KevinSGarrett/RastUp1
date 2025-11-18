# Test Strategy — WBS-004 Authentication & Onboarding

## Objectives

- Validate security controls (password policy, breach detection, lockout, CAPTCHA triggers, MFA step-up).
- Ensure onboarding completeness gating and Safe-Mode behaviour align with blueprint thresholds.
- Provide regression harness executable via `node --test` until broader CI exists.

## Test Pyramid

- **Unit (this run)**:
  - Password scoring and breach handling.
  - Lockout window & CAPTCHA decision matrix.
  - MFA step-up requirements per action and risk level.
  - Onboarding completeness scoring and eligibility flags.
  - JSON-LD builder Safe-Mode filtering and hreflang coverage.
- **Contract (future)**:
  - GraphQL queries/mutations for auth and onboarding (requires schema from WBS-001/002).
  - Media moderation + S3 variant generation (depends on WBS-016).
- **E2E (future)**:
  - Playwright coverage for signup/login, SSO, MFA, onboarding steps, profile publish, Safe-Mode toggles.
  - Mobile regressions via Detox/Expo (post WBS-022).

## Test Cases Implemented Now

| Area | Scenario | Expected Outcome | Artifact |
|------|----------|------------------|----------|
| Password Policy | Long but weak password lacking digits | Fails; returns actionable feedback | `tests/frontend/auth/password_policy.test.mjs` |
| Password Policy | Breach API reports compromised hash | Validation rejects password, surfaces breach flag | same |
| Lockout & CAPTCHA | 5 consecutive failures | Account locks for 15 minutes; CAPTCHA required | `tests/frontend/auth/lockout_policy.test.mjs` |
| Lockout & CAPTCHA | High risk score but low attempts | CAPTCHA required without lockout | same |
| MFA Step-up | Payout change request | Mandatory step-up regardless of baseline risk | `tests/frontend/auth/mfa_policy.test.mjs` |
| MFA Step-up | Low-risk profile update | No step-up when risk low and factor trusted | same |
| Completeness Scoring | Provider missing portfolio | Score < threshold; publish blocked with reason | `tests/frontend/onboarding/completeness.test.mjs` |
| Completeness Scoring | Studio meets Instant Book criteria | Flags `instantBook: true` | same |
| Nudges | Identify top three missing fields | Returns prioritized nudges | `tests/frontend/onboarding/nudges.test.mjs` |
| SEO Builder | Safe-Mode active with flagged media | Excludes NSFW media from JSON-LD | `tests/frontend/profiles/seo_builder.test.mjs` |

## Tooling & Execution

- **Runner**: Node.js `node --test`.
- **Language**: ES Modules (`.mjs`).
- **Static checks**: None yet (TS/ESLint pending future run).
- **Command**: `node --test tests/frontend/**/*.test.mjs`

## Data & Fixtures

- In-memory stubs for breach API responses, risk assessment, and media moderation flags.
- Deterministic timestamps using fixed `Date` overrides where required.

## Acceptance & Reporting

- All unit tests must pass locally.
- Document command outputs in run report (`docs/runs/...`).
- Capture coverage gaps and TODOs for future agents.

## Future Enhancements

- Integrate with real auth backend stubs (Cognito/AppSync) for contract tests.
- Add accessibility (Axe) automation once UI exists.
- Include performance budget tests (Lighthouse CI) after Next.js scaffolding.

---

_Drafted by AGENT-3 on 2025-11-18._
