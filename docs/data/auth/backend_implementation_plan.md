# Backend Implementation Plan — WBS-003 Authentication & Authorization

## Context Snapshot

- **WBS**: `WBS-003` (Backend) — depends on `WBS-001`, `WBS-002`
- **Blueprints**: `NT-0087`, `TD-0302`, `TD-0311`, `TD-0312`
- **Role**: AGENT-2 (Backend & Services)
- **Assumptions**:
  - Aurora core schema from WBS-002 is authoritative for user identities.
  - No external identity provider SDKs are available during this run; cryptographic primitives must use Node.js stdlib.
  - Session cookies are issued by downstream web tier; this run provides signing/encryption helpers and storage contracts.

## Plan vs Done vs Pending (pre-run)

- **Done**: Core user tables (`core.user_account`) and domain helpers from WBS-002; frontend policy modules from WBS-004 for parity reference.
- **Planned (this run)**:
  1. Define backend auth domain modules covering credential lifecycle, federated SSO validation, MFA enrolment/step-up, and RBAC enforcement with just-in-time elevation.
  2. Extend Aurora schema with dedicated `auth` schema for sessions, device trust, MFA secrets, login attempts, and audit events.
  3. Provide session/cookie utilities implementing secure cookie attributes and rotating refresh tokens.
  4. Publish GraphQL contract stubs for auth flows and RBAC directives (aligned with AppSync/Lambda runtime) if time permits.
  5. Deliver comprehensive unit tests across Node (`node --test`) and Python (`pytest`) for critical flows.
- **Pending (future runs)**: Real provider integrations (Apple/Google token retrieval, SMS delivery), infrastructure automation, monitoring dashboards, and cross-service integration tests.

## Architectural Overview

### Domain Modules (under `services/auth/`)

1. **`types.ts`** — Shared types for credentials, tokens, MFA factors, device fingerprints, and RBAC context.
2. **`password.ts`** — Password hashing (scrypt + pepper support), strength enforcement, breach checker abstraction, and password rotation logic.
3. **`providers.ts`** — JWT validation helpers for Apple/Google ID tokens, including JWKS caching contract and nonce checks.
4. **`sessions.ts`** — Session issuance, refresh rotation, cookie metadata builders (`httpOnly`, `SameSite=Lax`, `Secure`, `Max-Age`), idle timeout enforcement, and device trust handshake.
5. **`mfa.ts`** — Enrollment, challenge issuance (SMS OTP and TOTP), verification, recovery code management, and step-up policy evaluation per action.
6. **`rbac.ts`** — Role evaluation, capability matrix, resource-scoped checks, and `requireElevation` helper for admin just-in-time elevation (JIT) with MFA proof binding.
7. **`events.ts`** — Builders for security telemetry and audit events (login success/failure, session refresh, step-up required/completed) aligned with `docs/data/events` manifest naming.
8. **`index.ts`** — Barrel export aligning `.ts` and `.js` consumers (pattern consistent with other services).

### Data Model Extensions (Aurora)

Create new migration `db/migrations/028_auth_system.sql` introducing schema:

- `auth.session`: stores session id, user id, device id, refresh token hash, issued/rotated timestamps, expiration, idle deadline, user agent, ip, risk score, revoked flag.
- `auth.session_event`: append-only audit trail for session lifecycle events.
- `auth.device_trust`: records device fingerprint with trust level, last seen, signed challenge.
- `auth.mfa_factor`: stores factor type (`sms_otp`, `totp`, `webauthn` placeholder), secret metadata, enrollment status, last verified at.
- `auth.mfa_challenge`: transient OTP challenges with expiry and attempt counters.
- `auth.login_attempt`: captures login attempts for lockout/CAPTCHA heuristics (`success`, `failure_reason`, `risk_signal`).
- `auth.admin_elevation`: tracks active JIT elevations with expiry and action scope.

All tables reference `core.user_account.user_id`, enforce TTL via partial indexes (`expires_at`), and leverage generated columns for hashed tokens.

### Session & Cookie Strategy

- Refresh tokens stored hashed (scrypt) with per-session salt and global pepper (read from env via injected secret provider).
- Access tokens (JWT-like) minted via signed payload (HS512) with 15-minute validity; helper returns string and associated cookie metadata (`Secure`, `HttpOnly`, `SameSite=Lax`, `Domain`, `Path=/`).
- Idle timeout default 30 minutes; enforce via `touchSession` to extend `idle_expires_at` if activity occurs under cap (12 hours rolling window).
- Device trust adds `trusted` flag, bypassing SMS MFA for low-risk actions unless session risk > threshold.

### MFA & Step-Up

- Factors defined per user; SMS factor stores phone + `last_verified_at` and `backup_codes` hashed.
- `requiresStepUp(action, context)` returns required factors based on action category (e.g. `payout_change`, `admin_elevation`, `email_update`).
- `beginSmsChallenge(sessionId, factorId)` persists OTP hashed with TTL, returns send payload (for future SMS integration) and metadata for tests.
- `verifyChallenge(sessionId, challengeId, code)` records attempt, enforces max tries (5), and updates `mfa_factor.last_verified_at`.

### RBAC & JIT Elevation

- Capability matrix derived from `UserRole` mapping: `buyer`, `provider`, `admin`, `support`, `trust`.
- Admin actions require either `admin` or `support` role plus active elevation token (signed JWT) with MFA proof reference.
- `authorize({ userRoles, resource, action, elevationToken })` returns decision object (`allow`, `deny`, `needs_elevation`, `needs_mfa`).
- `requestElevation(userId, actionScope)` issues challenge tied to MFA factor; upon success records `auth.admin_elevation` with expiry ≤ 15 minutes.

### External Integrations (Abstractions Only)

- **Breach Check**: `password.ts` exposes `checkPasswordCompromise(password, fetcher)` that accepts HTTP fetch trait; tests will stub.
- **JWKS Fetch**: `providers.ts` accepts async loader returning PEM/JWK for Apple/Google; caching left to caller but interface defined.
- **SMS Delivery**: `mfa.ts` returns payload describing `to`, `message`, `templateId` for future SMS service.
- **Device Fingerprint**: `sessions.ts` expects hashed fingerprint (provided by caller) to avoid storing PII raw.

### Telemetry & Auditing

- `events.ts` ensures every security action emits envelope conforming to manifest naming: e.g. `auth.session.created.v1`, `auth.mfa.challenge_issued.v1`.
- Provide helper to log structured audit rows aligning with `auth.session_event` table.
- Logging functions accept dependency-injected logger interface (default console) to facilitate tests.

### Out of Scope

- OAuth redirect/PKCE flows (handled by frontend/back-channel service later).
- WebAuthn factor support (scaffold placeholder only).
- Full GraphQL/API resolvers (only contracts and domain logic delivered here).
- Secrets management (callers must supply pepper, signing keys, SMS provider).

## Deliverables Checklist

1. `services/auth/` modules listed above (`.ts` + `.js` runtime build parity).
2. New SQL migration `db/migrations/028_auth_system.sql`.
3. Optional GraphQL schema additions under `api/schema/auth.graphql` (time permitting).
4. Unit tests in `tests/auth/*.test.mjs` for Node domain logic and `tests/python/test_auth_*` for schema validation.
5. Updated documentation (`docs/PROGRESS.md`, run report, attach pack).

## Risks & Mitigations

- **Complex crypto operations**: Use Node `crypto` primitives; provide deterministic vectors in tests to avoid flaky randomness.
- **Token leakage**: Ensure all stored tokens hashed; tests assert raw values never returned.
- **MFA drift**: Timestamps normalized to ISO strings; provide dependency injection for clock to ease testing.
- **Lock contention**: All DB operations will be represented as repository contract interfaces for future implementation; current run focuses on pure functions.

## Follow-Up Recommendations

- Implement repository layer interfacing with Aurora tables (ORM or direct SQL) and integrate with service runtime.
- Add contract tests for GraphQL resolvers once API layer scaffolded.
- Provision observability dashboards (success/failure rates, step-up events, lockout metrics).
- Evaluate addition of refresh token blacklists and device push notifications for new login alerts.
