# ChatGPT Rehydrate Instructions — RastUp1

When I start a NEW ChatGPT conversation about this project, I will:

1. In my terminal:

   cd /mnt/c/RastUp1
   cat docs/orchestrator/primer.md
   cat docs/PROGRESS.md
   cat docs/orchestrator/TODO_ORCHESTRATOR.md  # if present
   cat ops/orchestrator_capabilities.yaml      # if present

   (Optionally also: the latest run report from docs/runs/
    and the latest orchestrator review from docs/orchestrator/reviews/.)

2. Copy/paste those into the new chat and then say something like:

   "You are stepping into an existing Python-based orchestrator that controls
    4 real Cursor agents via cursor-agent for the RastUp1 repo.
    Here are the primer, progress, TODO, capabilities, and latest reports.
    First restate in your own words what this system is and where we are.
    Then help me with the next task, which is: <describe next task>."

This way I never need to paste the huge original log again.
