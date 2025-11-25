# Orchestrator Primer — RastUp1

_Last refreshed: 2025-11-25._

This is a short “drop-in” summary so a new AI helper (or a human)
can understand how the orchestrator and agents work in this repo.

---

## Repo & blueprints

- Repo root (WSL): `/mnt/c/RastUp1`
- Repo root (Windows): `C:\RastUp1`
- GitHub: `https://github.com/KevinSGarrett/RastUp1`

Blueprints (non‑technical + technical project plans) have already been
ingested earlier in this project. Their processed, chunked form lives
under `docs/blueprints/`. You normally do **not** need to re-run
ingestion unless the source documents change.

---

## Orchestrator vs Agents

- **Orchestrator** (Python `orchestrator/` package):
  - Owns the WBS: `ops/wbs.json`
  - Owns the queue: `ops/queue.jsonl`
  - Reads blueprints, plans work, dispatches tasks to agents
  - Uses OpenAI + Anthropic (via env vars) for planning and reviews
  - Updates progress docs and WBS statuses

- **Agents** (AGENT‑1 … AGENT‑4, usually Cursor agents):
  - Receive task files under `ops/tasks/AGENT-N/WBS-XXX-*.md`
  - Produce run reports under `docs/runs/`
  - Optionally produce zip attachments under
    `docs/orchestrator/from-agents/AGENT-N/`

The orchestrator is the “manager”; the agents are the “workers”.

---

## Everyday commands (from repo root)

All commands below assume you’re in `/mnt/c/RastUp1` with the venv active.

- Show WBS / queue:

  - `python -m orchestrator.cli status`
  - `python -m orchestrator.task_status list`

- Dispatch next unblocked WBS task to an agent:

  - `python -m orchestrator.cli run-next`

- Review the latest agent run report and write an orchestrator review:

  - `python -m orchestrator.review_latest`

- Apply the latest orchestrator review back into WBS statuses:

  - `python -m orchestrator.apply_latest_review`

- Run full CI:

  - `make ci`

---

## Rehydrating a new chat/agent

When you start a new ChatGPT/Cursor window for this project:

1. From the repo, print and copy:
   - `docs/orchestrator/primer.md`
   - `docs/PROGRESS.md`
   - the latest review from `docs/orchestrator/reviews/`
   - the most relevant run report(s) from `docs/runs/`

2. Paste those into the new chat and say something like:
   “You are stepping into an existing orchestrator + 4 agents setup
    for the RastUp1 repo. Read these files, restate where we are,
    then help me with WBS-XXX.”

