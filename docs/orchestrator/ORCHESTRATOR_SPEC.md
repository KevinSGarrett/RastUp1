# Orchestrator Specification (High Level)

This file defines the high-level contract for the Orchestrator in this repo.
It is backed by a much more detailed specification captured in the long "Initial
prompt for cursor agents before we came up with the orchestrator strategy".

## Roles

- Orchestrator (OpenAI/Anthropic):
  - Reads and indexes blueprints.
  - Generates WBS and task queues.
  - Dispatches work to Cursor Agents via `cursor-agent`.
  - Reviews agent run reports.
  - Updates progress and OUTLINE.
  - Enforces access, security, and concordance policies.

- Cursor Agents (AGENT-1..4 via `cursor-agent`):
  - Implement code, infrastructure, tests, and docs.
  - Follow WBS tasks and run-report templates.
  - Produce run reports and attach packs for the Orchestrator.

## Responsibilities (Summary)

1. Blueprint-first planning and concordance (NT/TD indexes, crosswalk, CI gate).
2. Access Readiness Matrix, smoke suites, entitlements, and autopilot gate.
3. WBS and task queue management with dependencies and exit criteria.
4. Locking, ownership, and non-interference across agents.
5. Continuous run review and progress updates (PROGRESS.md, OUTLINE.md, POR).
6. Security and secrets policy (SECRET_MANAGER usage, rotation, security CI).
7. Model and tools logging (model-decisions.jsonl, tools-manifest.json).
8. Recovery, rotation, and stale-lock handling.
9. Documentation as a first-class deliverable (run reports, runbooks, design docs).
10. CI gates and PR conventions (NT/TD/WBS trailers, access & traceability).

