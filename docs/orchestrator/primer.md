# Orchestrator Primer — RastUp1

_Last refreshed: 2025-11-26_

This file is the short “drop-in” summary so a new AI helper (or a human)
can quickly understand how the orchestrator + Cursor agents work for this
repo, without rereading old chat logs.

---

## 1. Project & Inputs

- **Repo**
  - Local root (WSL): `/mnt/c/RastUp1`
  - Local root (Windows): `C:\RastUp1`
  - Git remote: https://github.com/KevinSGarrett/RastUp1

- **Blueprints (already ingested)**
  - Non‑technical plan:  
    `ProjectPlans/Combined_Master_PLAIN_Non_Tech_001.docx`
  - Technical plan:  
    `ProjectPlans/TechnicalDevelopmentPlan.odt`
  - Ingested via:

        python -m orchestrator.cli ingest-blueprints

  - Indexed into:
    - `docs/blueprints/blueprint_index.json`
    - Per‑chunk markdown files under `docs/blueprints/`

The blueprints have been split into many chunks, summarised with OpenAI,
and embedded so the orchestrator can search them.

---

## 2. Roles & Responsibilities

### Orchestrator (this repo’s `orchestrator/` package)

- Owns the **WBS** (`ops/wbs.json`) and **task queue** (`ops/queue.jsonl`).
- Reads the blueprint index and plans work.
- Dispatches tasks to Cursor agents via `orchestrator.cli run-next`.
- Reviews agent run reports and updates statuses/progress.
- Enforces the policies in:

  - `docs/orchestrator/LONG_SPEC.md`
  - `docs/orchestrator/ORCHESTRATOR_SPEC.md`
  - `ops/orchestrator_capabilities.yaml`

### Cursor Agents (AGENT‑1…AGENT‑4, via `cursor-agent`)

- Each agent run is tied to a WBS item (e.g. WBS‑001).
- For each run, agents produce:

  - A **run report**:  
    `docs/runs/YYYY-MM-DD-WBS-XXX-AGENT-N.md`
  - An **attach pack** (zip with logs, git status, test output, etc.):  
    `docs/orchestrator/from-agents/AGENT-N/run-<timestamp>-attach.zip`

- The orchestrator treats agents as workers; it is the “boss”.

---

## 3. Core Commands

All commands assume:

    cd /mnt/c/RastUp1
    source .venv/bin/activate

### 3.1 One‑time / rare setup

- **Initialise orchestrator layout** (config, docs, empty queue):

      python -m orchestrator.cli init

- **Ingest & index blueprints** (heavy):

      python -m orchestrator.cli ingest-blueprints

- **Generate WBS + queue + human TODO:**

      python -m orchestrator.cli plan

- **Build a file/directory index:**

      python -m orchestrator.cli index-files --max-files 300

### 3.2 Day‑to‑day WBS / queue operations

- **See WBS + queue status:**

      python -m orchestrator.cli status
      python -m orchestrator.task_status list

- **Run the next unblocked WBS item via Cursor agent:**

      python -m orchestrator.cli run-next

  This:
  - Creates a task file under `ops/tasks/AGENT-N/…`
  - Calls `cursor-agent` with the task instructions
  - Expects the agent to produce a run report + attach pack

- **Manually adjust a WBS item (when needed):**

      python -m orchestrator.task_status set --id WBS-004 --status todo
      python -m orchestrator.task_status set --id WBS-004 --status done

### 3.3 Review, progress, and autopilot

- **Review the latest agent run report (OpenAI + Anthropic “manager”):**

      python -m orchestrator.review_latest

  Writes an orchestrator review to:

      docs/orchestrator/reviews/orchestrator-review-*.md

- **Apply the latest orchestrator review back to WBS statuses:**

      python -m orchestrator.apply_latest_review

- **Sweep all in‑progress items and decide whether to reset to `todo`:**

      python -m orchestrator.review_all_in_progress

- **Autopilot loop (dispatch, review, update, push):**

      python -m orchestrator.autopilot_loop

  Typical loop:
  1. `run-next`
  2. Wait for agent
  3. Review + update statuses
  4. Optionally commit & push

---

## 4. CI, Tests & Guardrails

### 4.1 Local CI

- **Full local CI (TypeScript + Python + Node + infra checks):**

      make ci

  This runs (via the `Makefile`):

  - `node-install` (root + `web/` Node deps as needed)
  - TypeScript typecheck (`tsconfig.ci.json` + `web/tsconfig.json`)
  - Python tests under `tests/python` and `tests/search`
  - Node tests under `tests/frontend`, `tests/booking`, `tests/search`, `tests/docs`
  - Infra guardrails:

        python -m tools.infra.preflight --format text
        python -m tools.infra.smoke --format text

### 4.2 GitHub Actions CI

- GitHub workflow: `.github/workflows/ci.yml`

  On `push` and `pull_request`, it:

  - Checks out the repo
  - Sets up Python 3.12 and Node 20
  - Installs Python deps (`requirements.txt`)
  - Runs `make node-install`
  - Runs the full `make ci` suite

CI must be green before a WBS item is truly “done”.

---

## 5. Runs, Locks, and Indexes

- **Run reports:**  
  `docs/runs/YYYY-MM-DD-WBS-XXX-AGENT-N.md`

- **Orchestrator run index:**  
  `docs/orchestrator/_index/runs_index.csv`  
  `docs/orchestrator/_index/runs_index.md`  
  (maintained by a helper like `tools/index/verify_runs_index.py`.)

- **Attach packs:**  
  `docs/orchestrator/from-agents/AGENT-N/run-<timestamp>-attach.zip`  
  Contain `git-status.txt`, `node-tests.txt`, `pytest-results.txt`,
  `preflight.json`, `smoke.json`, `manifest.json`, `run-report.md`, etc.

- **Locks:**  
  `ops/locks/AGENT-N.lock`  
  Used to avoid two agents stepping on the same scope at once.

- **Model decisions log:**  
  `ops/model-decisions.jsonl`  
  Append‑only log of which models were used for which WBS / task.

---

## 6. Current High‑Level State (as of 2025‑11‑26)

From the latest runs and status commands:

- **WBS items completed:**

  - `WBS-001` — Infrastructure Bootstrap and DevOps Setup  
  - `WBS-002` — Core Backend Services: Profiles, Booking, Payments, Trust  
  - `WBS-003` — Frontend: Profiles, Search, Booking UI, Messaging  
  - `WBS-004` — QA, Security, Documentation, Release & Orchestrator Improvements  

- **Queue:**

      python -m orchestrator.cli status

  Currently reports:

  - `done: 4`
  - No unblocked `todo` items:

        python -m orchestrator.cli run-next
        → [run-next] No unblocked todo items found.

At this moment, the backlog in `ops/wbs.json` is fully processed
according to the orchestrator’s queue (all four defined WBS items are done).

---

## 7. How to “Rehydrate” a New AI Helper

When you open a **new** ChatGPT / AI session and want it to understand
this project, do this from the repo root:

1. Print the key context files:

       cd /mnt/c/RastUp1
       source .venv/bin/activate

       cat docs/orchestrator/primer.md
       cat docs/PROGRESS.md || echo "No PROGRESS.md yet"
       cat docs/orchestrator/TODO_ORCHESTRATOR.md || echo "No TODO_ORCHESTRATOR.md yet"
       cat ops/orchestrator_capabilities.yaml
       ls docs/orchestrator/reviews 2>/dev/null | tail -n 3

2. Open the most recent orchestrator review and the run report(s)
   relevant to the WBS you care about, for example:

       cat docs/orchestrator/reviews/orchestrator-review-<latest>.md
       cat docs/runs/2025-11-26-WBS-004-AGENT-4.md

3. Paste those into the new chat and say something like:

   > You are stepping into an existing orchestrator + 4‑agent setup  
   > for the RastUp1 repo. Here is the primer and recent reviews.  
   > Read them, restate in your own words where the project is up to,  
   > then help me with: <NEXT THING I WANT>.

That’s your rotation/rehydration protocol: instead of relying on the
old chat history, you always trust the repo artifacts.

---

## 8. Where to Look Next

When deciding what to do next, prefer **these** sources, in order:

1. `python -m orchestrator.cli status`  
2. `python -m orchestrator.task_status list`  
3. `docs/PROGRESS.md`  
4. `docs/orchestrator/TODO_ORCHESTRATOR.md`  
5. Latest orchestrator review in `docs/orchestrator/reviews/`

The chat is just an interface. The repo, queue, and run reports are
the real source of truth.

