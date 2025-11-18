# Implementation Plan — WBS-004 (User Authentication & Onboarding)

## Context Snapshot

- **WBS**: `WBS-004` (Frontend) — depends on `WBS-001`, `WBS-002`
- **Blueprints**: `TD-0302`, `TD-0303`, `TD-0311` – `TD-0319`
- **Role**: AGENT-3 (Frontend & Developer Experience)
- **Baseline**: No frontend scaffolding, auth UI, or onboarding flows exist in the repo. Backend schemas (Aurora, events) and search modules are available from prior WBS runs.

## Pre-Run Summary (Plan vs Done vs Pending)

- **Planned for this iteration**
  - Define frontend architecture & data contracts for auth, onboarding, profile publishing, and Safe-Mode enforcement.
  - Deliver reusable logic modules (password policy, lockout & CAPTCHA heuristics, MFA/step-up gating, onboarding completeness scoring, SEO JSON-LD builders).
  - Capture UX/UI flow specifications, state machine diagrams, and data requirements for future Next.js implementation.
  - Provide automated tests covering policy logic and onboarding scoring.
  - Document test strategy, risks, and follow-on tasks; package run report & artifacts per orchestrator requirements.
- **Already Done**: None (fresh scope; only discovery completed).
- **Pending**: Full UI implementation, integration with AppSync/GraphQL endpoints, media processing hooks, CI wiring, and E2E/browser automation.

## Architecture Approach

### Authentication Surface

1. **Identity Providers**
   - Primary email/password with risk-scored CAPTCHA fallback.
   - Federated SSO (Apple, Google) via OAuth/OpenID — align with `auth_sso_google_apple.spec.ts`.
   - Optional SMS OTP enrolment for step-up and passwordless fallback (uses existing event contracts once provisioned).

2. **Security Controls**
   - Password policy enforcing length ≥ 12, complexity heuristics, dictionary denial list, breach API checks (HIBP or internal).
   - Lockout after 5 consecutive failures within 15 minutes; CAPTCHA requirement when device/IP risk ≥ threshold or velocity flagged.
   - Session hardening: httpOnly/SameSite=Lax cookies, device fingerprint metadata stored server-side, rolling refresh tokens.
   - MFA policy: optional user opt-in, mandatory step-up for payouts, email change, and DSAR as referenced by `auth_mfa_stepup.spec.ts`.

3. **Client Modules (this run)**
   - Policy evaluator exports (password strength, breach checks, lockout/captcha gating).
   - MFA step-up orchestrator (determine when to prompt, manage factors).
   - Event payload builders for telemetry/logging.

### Onboarding & Profile Publishing

1. **Personas**
   - Providers (models, photographers, creative services).
   - Hosts/Studios with space listings.

2. **Wizard Structure**
   - Step configuration metadata describing prerequisites, autosave payload shapes, and exit criteria.
   - Role-specific branching: Provider (identity → portfolio → packages → availability → verification). Host (studio details → amenities → photos → policies → verification).
   - Autosave harness with optimistic sync, error surfaces, and offline queue (to be implemented in Next.js app later).

3. **Completeness & Gating**
   - Scoring engine weighting identity verification, media quality, pricing coverage, availability, testimonials.
   - Publish eligibility thresholds for: public profile visibility, Instant Book toggle, ranking boost.
   - Safe-Mode enforcement ensures any flagged NSFW media blocks publish to public surfaces until moderated SFW variants exist.

4. **Nudges & Digest**
   - In-app banners, email digests (weekly) summarizing incomplete steps, upcoming verification deadlines, and performance tips.
   - Event-driven triggers aligned with `growth_digests.spec.ts` and messaging blueprint.

### Public Profile, SEO & Safe-Mode

1. **Public Profile Rendering**
   - Card + long-form page templating with verified badges, role chips, pricing bands, availability preview (read-only).
   - Read models sourced from Search/GraphQL once WBS-003 APIs complete.

2. **SEO/Structured Data**
   - JSON-LD builders for `Person`, `LocalBusiness`, `CreativeWork` as appropriate.
   - Hreflang + canonical metadata hooked into Next.js layout (deferred).
   - Safe-Mode filtering ensures only SFW derivatives shown; NSFW hidden with placeholder messaging.

3. **Analytics & Telemetry**
   - Event contracts for wizard step completion, MFA prompts, CAPTCHA invocation, publish toggles.
   - CWV budgets (LCP/INP/CLS) tracked via Lighthouse CI (future run).

## Deliverables Planned for This Run

1. **Documentation**
   - This implementation plan.
   - UX flow specification & state machine notes for auth/onboarding (docs/data/auth/ui_flows.md).
   - Test strategy outline (docs/data/auth/test_plan.md).

2. **Runtime-Agnostic Logic Modules (under `tools/frontend/**`)**
   - `auth/password_policy.mjs` — scoring, validation, breach API interface.
   - `auth/lockout_policy.mjs` — adaptive lockout & CAPTCHA heuristics.
   - `auth/mfa_policy.mjs` — factor management & step-up evaluation.
   - `onboarding/wizard_config.mjs` — step metadata + traversal helpers.
   - `onboarding/completeness.mjs` — scoring and gating evaluation.
   - `onboarding/nudges.mjs` — cadence + message selection.
   - `profiles/seo_builder.mjs` — JSON-LD output with Safe-Mode enforcement.

3. **Automated Tests (under `tests/frontend/**`)**
   - Coverage for password policy edge cases.
   - Lockout/CAPTCHA scenarios.
   - Completeness scoring thresholds & gating decisions.
   - JSON-LD safe-mode filtering and localization tags.

4. **Reporting & Packaging**
   - Run report, manifest, diff summary, and test artifacts zipped under `docs/orchestrator/from-agents/AGENT-3/`.

## Integration Touchpoints

- **Backend Contracts**: Aligns with `api/schema/search.graphql`, event schemas from `docs/data/events`, and Aurora tables for users & profiles.
- **Security Signals**: Device recognition events feed `security/controls_matrix.csv` (future) and Observability dashboards.
- **Media Service**: Coordinates with planned S3 moderation pipeline (WBS-016) for SFW derivatives.
- **Notifications**: Nudges/digests rely on Messaging & Growth blueprints (WBS-015, WBS-014).

## Risks & Open Questions

- **Missing Frontend Scaffold**: No Next.js project or build tooling exists. Implementation here focuses on headless logic; UI integration remains pending.
- **External Service Stubs**: Breach checks, CAPTCHA, OTP dispatch require backend integrations not yet implemented.
- **CI Tooling**: `make ci` absent; Node/TypeScript toolchain needs bootstrapping (flagged by AGENT-2).
- **Media Moderation**: SFW enforcement depends on WBS-016 delivering moderation outcomes and variant URLs.

## Next Steps (Post-Run Recommendations)

1. Scaffold Next.js app with routing, layout, and shared design system.
2. Implement GraphQL client + auth context hooking these policies into actual UI flows.
3. Add Playwright E2E coverage for signup/login, onboarding wizard, MFA step-up, and publish gating.
4. Integrate real breach/CAPTCHA services and device fingerprint telemetry.
5. Wire weekly digest generation to notifications framework once available.

---

_Last updated: 2025-11-18T08:25Z by AGENT-3._
