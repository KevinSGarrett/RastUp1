from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def run(cmd: list[str], *, capture: bool = False) -> subprocess.CompletedProcess:
    """Run a command from the repo root."""
    return subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        capture_output=capture,
    )


def main() -> None:
    print("[autopilot] Starting orchestrator autopilot loop.")

    max_loops = int(os.getenv("ORCHESTRATOR_AUTOPILOT_MAX_LOOPS", "100"))
    sleep_seconds = int(os.getenv("ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS", "5"))

    for i in range(1, max_loops + 1):
        print(f"\n[autopilot] === Iteration {i} ===")

        # 1) Dispatch the next WBS task via orchestrator.cli run-next
        print("[autopilot] Dispatching next task with `python -m orchestrator.cli run-next` ...")
        proc_run = run([sys.executable, "-m", "orchestrator.cli", "run-next"], capture=True)

        output = (proc_run.stdout or "") + (proc_run.stderr or "")
        print(output, end="")

        if "No unblocked todo items found." in output:
            print("[autopilot] No unblocked todo items found. Stopping autopilot.")
            break

        if proc_run.returncode != 0:
            print(f"[autopilot] ERROR: run-next exited with {proc_run.returncode}; stopping.")
            print("--- run-next output (for debugging) ---")
            print(output)
            print("---------------------------------------")
            break

        # 2) Have the orchestrator (OpenAI) review the latest run report
        print("[autopilot] Running `python -m orchestrator.review_latest` ...")
        proc_review = run([sys.executable, "-m", "orchestrator.review_latest"], capture=True)
        print(proc_review.stdout or "", end="")
        print(proc_review.stderr or "", end="")
        if proc_review.returncode != 0:
            print(f"[autopilot] WARNING: review_latest exited with {proc_review.returncode}; continuing anyway.")

        # 3) Apply the review to WBS status (done vs in_progress)
        print("[autopilot] Running `python -m orchestrator.apply_latest_review` ...")
        proc_apply = run([sys.executable, "-m", "orchestrator.apply_latest_review"], capture=True)
        print(proc_apply.stdout or "", end="")
        print(proc_apply.stderr or "", end="")
        if proc_apply.returncode != 0:
            print(f"[autopilot] WARNING: apply_latest_review exited with {proc_apply.returncode}; continuing anyway.")

        # 4) Update PROGRESS.md based on the queue
        print("[autopilot] Running `python -m orchestrator.update_progress` ...")
        proc_progress = run([sys.executable, "-m", "orchestrator.update_progress"], capture=True)
        print(proc_progress.stdout or "", end="")
        print(proc_progress.stderr or "", end="")
        if proc_progress.returncode != 0:
            print(f"[autopilot] WARNING: update_progress exited with {proc_progress.returncode}; continuing anyway.")

        # 5) Commit & push everything
        print("[autopilot] Running `python -m orchestrator.commit_and_push` ...")
        proc_git = run([sys.executable, "-m", "orchestrator.commit_and_push"], capture=True)
        print(proc_git.stdout or "", end="")
        print(proc_git.stderr or "", end="")
        if proc_git.returncode != 0:
            print(f"[autopilot] WARNING: commit_and_push exited with {proc_git.returncode}; continuing anyway.")

        # 6) Cool‑down before next iteration
        print(f"[autopilot] Sleeping {sleep_seconds}s before next iteration ...")
        time.sleep(sleep_seconds)

    print("[autopilot] Autopilot loop finished.")


if __name__ == "__main__":
    main()
