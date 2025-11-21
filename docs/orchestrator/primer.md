# Orchestrator Primer — RastUp1 (Short)

## Repo & Blueprints

- Repo root (Windows): C:\RastUp1
- Repo root (WSL): /mnt/c/RastUp1

- Main project blueprints:
  - Non‑tech: ProjectPlans/Combined_Master_PLAIN_Non_Tech_001.docx
  - Tech:     ProjectPlans/TechnicalDevelopmentPlan.odt

- We already ran `python -m orchestrator.cli ingest-blueprints`:
  - Both docs were converted to markdown under docs/blueprints/.
  - They were chunked into ~932 chunks (NT‑xxxx and TD‑xxxx).
  - Each chunk was summarised with OpenAI and embedded.
  - All of this is indexed in docs/blueprints/blueprint_index.json.

This index + the chunk markdown files are how the orchestrator and agents
see the full 500k+ words without hitting token limits.

## Orchestrator Responsibilities (Python package `orchestrator/`)

- Owns the Work Breakdown Structure:
  - ops/wbs.json      → WBS items and dependencies
  - ops/queue.jsonl   → queue of tasks with status (todo / in_progress / done)
  - docs/TODO_MASTER.md → human-readable WBS list

- Uses OpenAI (and optionally Anthropic) for:
  - Blueprint ingestion (summaries + embeddings)
  - Planning the WBS and queue
  - File indexing (docs/FILE_INDEX.*)
  - Reviewing agent run reports and updating statuses

- Dispatches work to 4 Cursor agents using the Cursor CLI.

## Cursor Agents (real agents, not just roles)

AGENT‑1 — Bootstrap & DevOps  
AGENT‑2 — Backend & Services  
AGENT‑3 — Frontend & Developer Experience  
AGENT‑4 — QA, Security, Docs, Release  

For each WBS item:

1. The orchestrator picks the next unblocked todo item from ops/queue.jsonl.
2. It writes a task file under ops/tasks/AGENT-N/ with:
   - WBS ID
   - Relevant NT/TD IDs from the blueprint index
   - Allowed paths to edit (scope_paths)
   - Test commands that must be run
   - Run-report + attach-pack requirements
3. It calls Cursor CLI (cursor-agent) to run the appropriate AGENT‑N
   using Cursor’s models and plugins.
4. When the agent finishes and writes its run report + attach pack, the
   orchestrator:
   - updates ops/queue.jsonl (status),
   - updates docs/PROGRESS.md,
   - may update other progress/outline files.

Cursor uses its own models; the orchestrator uses my OpenAI/Anthropic keys.

## Key Commands (run from /mnt/c/RastUp1)

- Initialise orchestrator layout:
    python -m orchestrator.cli init

- Ingest blueprints (heavy, already run at least once):
    python -m orchestrator.cli ingest-blueprints

- Plan WBS + queue:
    python -m orchestrator.cli plan

- Index repo files:
    python -m orchestrator.cli index-files --max-files 300

- Show status:
    python -m orchestrator.cli status
    python -m orchestrator.task_status list

- Run next WBS task via Cursor agent:
    python -m orchestrator.cli run-next

- Review and adjust WBS statuses:
    python -m orchestrator.review_latest
    python -m orchestrator.apply_latest_review
    python -m orchestrator.review_all_in_progress

- Autopilot loop (dispatch + review + progress + git):
    python -m orchestrator.autopilot_loop

## Where to look for "what actually happened"

- docs/runs/                         → Cursor agent run reports
- docs/orchestrator/from-agents/     → attach packs (.zip)
- docs/orchestrator/reviews/         → orchestrator reviews
- docs/PROGRESS.md                   → human summary of current status
- ops/wbs.json / ops/queue.jsonl     → canonical WBS + queue