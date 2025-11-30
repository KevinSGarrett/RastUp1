# Backend Test Plan — WBS-003 Authentication & Authorization

## Objectives

- Validate credential, MFA, session, and RBAC domain logic aligns with blueprint controls.
- Ensure security invariants (hashed storage, cookie flags, lockout thresholds) are enforced via automated tests.
- Provide repeatable harnesses (`node --test`, `pytest`) runnable without external network calls.

## Scope

- **In Scope**: Password policy & hashing, breach-check adapter behaviour, SSO token validation helpers, session issuance/rotation, device trust logic, MFA enrollment & verification, RBAC decision matrix, admin elevation workflow, audit event builders.
- **Out of Scope**: Actual network calls to Apple/Google/SMS providers, database repository integration, GraphQL resolver wiring, WebAuthn attestation.

## Test Harnesses

- **JavaScript** (`node --test`): Unit tests exercising domain modules under `services/auth/*.js`.
- **Python** (`pytest`): Schema validation tests ensuring new SQL migration conforms to expectations (enum values, FK constraints, indexes).
- **Static Checks**: None (TypeScript compilation deferred until toolchain exists).

## Test Matrix

| Module | Scenario | Expected Outcome | Artifact |
|--------|----------|------------------|----------|
| password | `hashPassword` uses scrypt with provided pepper & random salt | Result contains base64 salt & hash; verifies via `verifyPassword` | `tests/auth/password.test.mjs` |
| password | `evaluatePassword` rejects breached password via stubbed API | Returns failure with `compromised: true` | same |
| providers | Validate Google ID token signature against JWKS | Accepts token, extracts claims, enforces nonce/audience | `tests/auth/providers.test.mjs` |
| providers | Reject Apple token with expired `exp` | Throws `AuthError` code `TOKEN_EXPIRED` | same |
| sessions | Issue session creates cookie descriptors with httpOnly/Secure/SameSite | Descriptors match blueprint | `tests/auth/sessions.test.mjs` |
| sessions | Refresh rotation invalidates old refresh hash | Old hash not accepted; events recorded | same |
| mfa | Enroll SMS factor normalizes phone, hashes backup codes | Factor object stored hashed | `tests/auth/mfa.test.mjs` |
| mfa | Challenge verification enforces attempt limit and TTL | Exceeding limit returns lock state | same |
| rbac | Buyer cannot access admin action | Returns `{ allow: false, reason: 'ROLE_MISSING' }` | `tests/auth/rbac.test.mjs` |
| rbac | Admin without elevation gets `needs_elevation` on restricted action | same |
| events | `buildAuthEventEnvelope` outputs metadata per manifest | Envelope validated | `tests/auth/events.test.mjs` |

Python coverage:

| Area | Scenario | Artifact |
|------|----------|----------|
| Schema | `auth.session` has FK to `core.user_account` and indexes on `(user_id, expires_at)` | `tests/python/test_auth_schema.py` |
| Schema | Enums/tables created with expected columns | same |
| Schema | `auth.login_attempt` retains check constraints on `outcome` values | same |

## Execution Plan

1. Run JS tests: `node --test tests/auth/*.test.mjs`.
2. Run Python tests: `pytest tests/python/test_auth_schema.py`.
3. (Optional) Run repo-wide checks: `make ci` (expected failure until bootstrap); document outcome.

## Test Data & Fixtures

- Deterministic salts, peppers, and keypairs embedded in tests for reproducibility.
- JWKS fixtures encoded inline for Apple/Google verification tests.
- Fixed clock utilities for session/MFA TTL assertions.

## Acceptance Criteria

- All new tests pass locally.
- Security invariants confirmed via assertions (no plaintext secrets, correct cookie flags).
- Run report documents commands, outputs, and any skipped coverage with rationale.

## Risks & Mitigations

- **Cryptographic timing**: Use deterministic salts in tests, but ensure production functions default to secure randomness; tests assert stub injection.
- **Cross-language drift**: Keep SQL schema expectations in Python tests up to date with migration file.
- **Missing CI**: Capture inability to run `make ci` (consistent with prior runs) and flag in run report.

## Follow-Up Testing

- Add integration tests against future GraphQL resolvers (AppSync) once implemented.
- Incorporate load testing for session issuance and lockout event volume.
- Validate SMS delivery infrastructure via contract tests when provider ready.
