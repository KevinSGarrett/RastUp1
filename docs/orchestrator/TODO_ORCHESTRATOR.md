# Orchestrator TODO (Autopilot Brain)

This file is the working checklist for turning the long-form orchestrator
spec (the giant "Initial prompt for cursor agents..." you wrote) into
concrete repo artifacts and CI-enforced behavior.

The high-level capabilities are mirrored from `ops/orchestrator_capabilities.yaml`
and the long-form rules now live in `docs/orchestrator/LONG_SPEC.md`
(your original orchestrator prompt, saved into the repo).

---

## Verticals (End-to-End Flows)

This section tracks concrete “vertical” flows that cut across multiple subsystems
(search, profile, booking, auth, payments, messaging, etc.). Each vertical should have:

- A checklist doc under `docs/checklists/`.
- Design references under `docs/design/`.
- At least one WBS item in `ops/wbs.json`.
- At least one E2E smoke path once the UI is more complete.

### V-001: Search → Profile → Booking → Signup → Payment

Targets:

- `docs/checklists/search_profile_booking.md`
- `docs/design/foundations.md`
- `web/app/search`, `web/app/booking`
- `web/components/Search/*`, `web/components/Profile/*`, `web/components/Booking/*`

Tasks:

- [x] Create vertical checklist file:
      - `docs/checklists/search_profile_booking.md`.
- [x] Draft design foundations v0:
      - `docs/design/foundations.md`.
- [x] Implement initial search/profile/booking pages wired to stub stores
      and data sources (WBS-003).
- [x] Add at least one visible UX improvement to the Search UI
      (results header + empty state).
- [ ] Add a dedicated WBS entry in `ops/wbs.json` for
      “V-001: Search → Profile → Booking → Signup → Payment” that:
      - References this checklist.
      - Lists primary code paths (search workspace, profile page, booking page,
        auth/signup, payment).
      - Has clear “done” criteria tied to the checklist.
- [ ] Extend `docs/PROGRESS.md` / `docs/OUTLINE.md` (once implemented) to
      show per-vertical status using the checklist.
- [ ] Add an E2E smoke test covering this full vertical (e.g. Playwright):
      - Search → open profile → start booking → (stub) signup/login → (stub) payment.
      - Wire into `make ci` or a dedicated `make test-e2e`.
- [ ] Teach `orchestrator.autopilot_loop` (or a future planner) to prefer
      completing one vertical before spreading to new ones when reasonable.

### Future verticals (examples)

- [ ] V-002: Messaging → Moderation → Safe Mode
- [ ] V-003: Studio Management → Availability → Calendar Connect
- [ ] V-004: Disputes → Evidence → Payouts

---

## 0. Pre-flight / Meta

- [ ] (Optional but recommended) Save the full "Initial prompt for cursor agents
      before we came up with the orchestrator strategy" into:
      - `docs/orchestrator/LONG_SPEC.md`
      so agents and tools can read it directly from the repo.

- [ ] Ensure `docs/orchestrator/ORCHESTRATOR_SPEC.md` and
      `ops/orchestrator_capabilities.yaml` stay in sync whenever we add/change
      orchestrator behavior.

---

## 1. Blueprint Concordance (NT/TD ↔ Code/Tests)

Targets (from capabilities):
- `docs/blueprints/nt-index.json`
- `docs/blueprints/td-index.json`
- `docs/blueprints/crosswalk.json`
- `ci/concordance-check.yml`

Tasks:
- [ ] Define schemas for:
      - `nt-index.json` (NT-id → title, file, anchor, brief)
      - `td-index.json`
      - `crosswalk.json` (NT ↔ TD ↔ WBS ↔ code/tests/owner/status)
- [ ] Write scripts under `scripts/concordance/` to:
      - Parse the non-tech blueprint into `nt-index.json`.
      - Parse the tech blueprint into `td-index.json`.
      - Update `crosswalk.json` based on PR diffs and commit trailers (NT/TD/WBS).
- [ ] Add `ci/concordance-check.yml` that fails PRs if:
      - Changed code paths lack NT/TD/WBS trailers.
      - NT items for the relevant phase are uncovered.
      - TD items appear without a mapped NT (unless explicitly allowed).
- [ ] Add nightly/adhoc concordance coverage report under
      `docs/reports/concordance-coverage.md`.

---

## 2. Access Readiness & Autopilot Gating

Targets:
- `docs/runbooks/access-readiness-matrix.md`
- `scripts/smoke/`
- `ci/smoke.yml`
- `ops/access/entitlements.yaml`

Tasks:
- [ ] Design the Access Readiness Matrix structure in
      `docs/runbooks/access-readiness-matrix.md`
      (resources, capabilities, agents, command/check, expected result, status).
- [ ] Add smoke scripts per agent under `scripts/smoke/` (bash + optional PowerShell):
      - A-1: infra/CI/registry/secret-manager smoke.
      - A-2: backend/API/schema smoke.
      - A-3: frontend/build/preview smoke.
      - A-4: tests/security/perf smoke.
- [ ] Add `ci/smoke.yml` to run the smoke suites in CI and upload logs to
      `docs/test-reports/smoke/`.
- [ ] Define `ops/access/entitlements.yaml` mapping:
      - Capabilities → principals (agents, CI, manual helper).
      - Roles/permissions for AWS, GitHub, registry, secret manager, etc.
- [ ] Encode an "autopilot gate" rule: autopilot is only considered ON when
      critical rows (FS, Docker, CI, registry, secret store) are PASS.
- [ ] Teach the Access Readiness Matrix to consume the existing `tools.infra.preflight`
      / `tools.infra.smoke` outputs (or their JSON variants) so infra readiness
      becomes part of the ON/OFF gate instead of a separate manual check.

---

## 3. Progress Model & OUTLINE

Targets:
- `docs/PROGRESS.md`
- `ops/por.json` (plan of record)
- `docs/OUTLINE.md`

Tasks:
- [ ] Define the schema for `ops/por.json` (topological WBS/phase graph).
- [ ] Implement a small script (later) that:
      - Reads `ops/queue.jsonl` + `ops/por.json` + `docs/blueprints/crosswalk.json`.
      - Computes phase and overall progress.
      - Writes `docs/PROGRESS.md` in the canonical format.
- [ ] Implement generation/update logic for `docs/OUTLINE.md`:
      - One section per phase.
      - Checkbox per WBS item with NT/TD refs and links.
- [ ] (Later) Add `python -m orchestrator.cli update-progress` to:
      - Run the progress calculation.
      - Update `docs/PROGRESS.md` and `docs/OUTLINE.md`.

---

## 4. Run Review & Orchestrator IQ

Targets (eventually):
- `python -m orchestrator.cli review-latest`
- `python -m orchestrator.cli update-progress`
- `docs/orchestrator/primer.md`
- `docs/orchestrator/rotations/`

Tasks:
- [ ] Define a canonical "run-review" format that:
      - Reads latest run reports under `docs/runs/YYYY-MM-DD/AGENT-*/`.
      - Summarizes Plan vs Done vs Pending per WBS item.
      - Emits a human-friendly summary plus machine-friendly notes.
- [ ] Later: implement `review-latest` command that:
      - Scans `docs/runs/` and `docs/orchestrator/from-agents/`.
      - Uses OpenAI/Anthropic (via `llm_client.py`) to summarize.
      - Optionally suggests queue status updates (WBS → done/review/blocked).
- [ ] Define and create `docs/orchestrator/primer.md` as the quick "rehydrate"
      document for new sessions/windows.
- [ ] Define rotation folder structure under
      `docs/orchestrator/rotations/` for session handoff bundles.
- [ ] Teach the run-review flow to parse "Missing Deliverables" and
      "Recommended Follow-Ups" sections from agent reports and automatically
      propose structured backlog entries (e.g., new WBS items or orchestrator
      TODO bullets) instead of relying only on manual copy/paste.
- [ ] Add a notion of "strictness tier" per WBS (foundation vs feature vs
      stretch) in `ops/orchestrator_capabilities.yaml`, and have
      `apply_latest_review` use it when deciding whether a partially completed
      WBS is allowed to move to `done` **only if** all follow-ups are captured
      as explicit backlog items.

---

## 5. Security & Secrets

Targets:
- `ops/secrets/rotation.jsonl`
- `docs/security/threat-model.md`
- `ci/security.yml`
- `ci/deps-license.yml`

Tasks:
- [ ] Define secrets naming convention and document it:
      - `[APP]/[ENV]/[SUBSYSTEM]/[KEY]`.
- [ ] Implement rotation ledger format in `ops/secrets/rotation.jsonl`.
- [ ] Add `ci/security.yml`:
      - SAST, secret scanning, basic checks.
- [ ] Add `ci/deps-license.yml`:
      - Dependency + license scanning.
- [ ] Create `docs/security/threat-model.md` skeleton (threat model outline).

---

## 6. Locking, Ownership, and Non-Interference

Targets:
- `ops/locks/`
- `ops/ownership.yaml`
- `.github/CODEOWNERS`

Tasks:
- [ ] Define `ops/locks/agent-<name>.lock` JSON schema:
      - task_id, owner, scope_paths, start_time, blueprint_refs.
- [ ] Document lock protocol in `docs/orchestrator/ORCHESTRATOR_SPEC.md`.
- [ ] Design `ops/ownership.yaml` format (globs → owners).
- [ ] Generate `.github/CODEOWNERS` from `ops/ownership.yaml`.
- [ ] (Later) Add CI preflight that:
      - Rejects PRs changing paths outside declared owner/scope.

---

## 7. Model & Tools Logging

Targets:
- `ops/model-decisions.jsonl`
- `ops/tools-manifest.json`

Tasks:
- [ ] Define schema for `ops/model-decisions.jsonl`:
      - { task_id, agent, model, max, reason, timestamp }.
- [ ] Define schema for `ops/tools-manifest.json`:
      - { task_id, agent, selected_plugins, reason, alternatives }.
- [ ] Ensure agent run reports write entries to both files.
- [ ] Add a small lint/CI check to keep `ops/model-decisions.jsonl` well-formed
      and free of stale entries, and to ensure it remains in sync with the
      models/tools actually used by the orchestrator.

---

## 8. Recovery & Rotation

Targets:
- `docs/orchestrator/primer.md`
- `docs/orchestrator/rotations/`

Tasks:
- [ ] Define recovery SOP for orphaned locks and stalled sessions.
- [ ] Describe rotation bundle format:
      - Which files go into each bundle (PROGRESS, OUTLINE, queue, last runs).
- [ ] (Later) Add helper script to package a rotation bundle as a zip under
      `docs/orchestrator/rotations/`.

---

## 9. External APIs (email, SMS, CAPTCHA, etc.)

These will be implemented as **normal WBS tasks** and wired to secrets +
config, but the orchestrator must remember to enforce:

- No hard-coded secrets or API keys.
- All config via env/secret manager references.

Tasks (planning-level; details to be filled by agents when we reach those WBS items):
- [ ] Define a "3rd-party integrations" section in the tech blueprint crosswalk
      (email verification, SMS, CAPTCHA, fraud, etc.).
- [ ] For each integration (e.g., email provider, SMS provider, CAPTCHA vendor):
      - Add NT/TD IDs in blueprints.
      - Add WBS items with clear exit criteria.
      - Add expected secret names into the secrets catalog/rotation ledger.
- [ ] Ensure CI has basic "integration smoke" tests (mocked or sandbox).

---

## 10. WBS-001 Follow-Ups (Infra Automation & CI Hardening)

Context: WBS-001 now gives you a green, guardrail-aware local CI (`make ci`)
and infra preflight/smoke tooling, but the deep AWS/IaC automation was
explicitly scoped out of this WBS and needs to land later.

Tasks:
- [ ] Design and implement AWS infra dry-run/static-analysis wrappers under
      `tools/infra/` (e.g., `cdk diff`, `cfn-lint`, `infracost`, AWS
      Organizations/AppConfig checks) and surface them via the existing
      `infra-preflight` / `infra-smoke` targets.
- [ ] Extend `make ci` and CI workflows to persist JSON artifacts for infra
      checks (preflight, smoke, rotation) under `docs/test-reports/infra/`
      and link them from run reports/attach packs.
- [ ] Automate attach-pack generation for infra/CI runs (zip containing
      `ci.txt`, `tests.txt`, infra JSON outputs, rotation summaries, manifest)
      and record the path in run reports so the orchestrator can consume it.
- [ ] Resolve the `runpy` module caching warnings for repeated
      `python -m tools.infra.*` invocations (e.g., by using a shared
      entrypoint function or `importlib`-based dispatch instead of
      multiple `-m` calls).
- [ ] Capture the "deep AWS infra" work as explicit WBS items in
      `ops/por.json` (Amplify/CDK stacks, AWS Organizations/AppConfig
      bootstrap, IaC static analysis, deployment validation) so the
      orchestrator can sequence them after WBS-001.
