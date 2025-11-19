> Orchestrator review generated at 20251119-205020Z UTC
> Reviewed run report: `docs/runs/2025-11-19-WBS-017-AGENT-3-Part3.md`
> WBS: WBS-017
> Model: gpt-5 (tier=high)

Summary: what’s done vs what remains

- Accomplished
  - Implemented a shared calendar data source with a GraphQL executor and an in-memory stub client.
  - Shipped a Next.js calendar dashboard page and client container wiring stores to UI actions (availability save, holds, external sync, ICS lifecycle) with telemetry hooks.
  - Added unit tests for the stub data source; full frontend and CI suites pass; progress docs updated.

- Remaining
  - Wire the dashboard to real AppSync/App Server endpoints (auth, env config, error handling) and persist telemetry.
  - Apply design system styling and accessibility polish.
  - Add integration/E2E/regression coverage once backend mutations are available.

Quality, risks, and missing automation/tests

- Quality
  - Good modular layering (data source abstraction, page/client split) and passing unit/CI runs.
  - Current validation is limited to stub mode; no proof against live GraphQL behavior.
  - Styling/a11y not yet addressed.

- Key risks
  - Contract drift between stub and real AppSync schema (types, required args, pagination, error shapes).
  - Auth/CORS/config issues for AppSync (API key/iam/cognito headers), SSR vs CSR fetch context, and environment resolution in Next.js.
  - ICS feed lifecycle and token/security handling; potential exposure or stale tokens.
  - Hold creation/reschedule concurrency and conflict handling not verified against backend.
  - Telemetry durability (offline queueing, batching) not implemented.
  - Without integration/E2E, regressions or UX breakages may go undetected.

- Missing automation/tests
  - Contract tests against the GraphQL schema (codegen/types, operation validation).
  - Integration tests for the GraphQL executor with mocked AppSync (msw/nock) covering success, auth failures, throttling, and retries.
  - Playwright/Cypress E2E for availability edits, hold creation, external calendar sync, and ICS enable/disable.
  - A11y checks (axe) and keyboard navigation tests.
  - Error-path unit tests (network failures, partial successes), and SSR/CSR edge cases.
  - Basic performance budget checks for the dashboard initial load.

Recommendation

Do NOT mark WBS-017 as complete.

To mark this WBS complete next:
- Implement live AppSync wiring with authenticated fetch, env/config plumbing, and minimal telemetry persistence.
- Add at least happy-path integration tests for core mutations and one Playwright flow covering availability save.
- Document setup/run steps for live mode and capture basic a11y fixes.
