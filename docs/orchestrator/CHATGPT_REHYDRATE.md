# ChatGPT Rehydrate Snippet — RastUp1 Orchestrator

When I start a **new** ChatGPT (or Cursor) window for this project,
I will do this from the repo root (`/mnt/c/RastUp1`):

```bash
source .venv/bin/activate

cat docs/orchestrator/primer.md
cat docs/PROGRESS.md
ls docs/orchestrator/reviews | tail -n 3
Then I will:
Copy/paste:
docs/orchestrator/primer.md
docs/PROGRESS.md
The latest orchestrator review from docs/orchestrator/reviews/
Any run report(s) under docs/runs/ for the WBS I care about
Tell the model something like:
You are stepping into an existing orchestrator + 4 agents setup
for the RastUp1 repo. Here is the primer, progress, latest review,
and recent run report(s). Read them, restate where we are, and
then help me with WBS-XXX.
This way, even if a chat window “forgets” context, we can quickly
re-teach it using repo truth instead of guessing from memory.
