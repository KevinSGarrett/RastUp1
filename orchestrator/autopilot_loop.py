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


def run_py_module(mod: str, *args: str, capture: bool = False) -> subprocess.CompletedProcess:
    return run([sys.executable, "-m", mod, *args], capture=capture)


def main() -> None:
    print("[autopilot] Starting orchestrator autopilot loop.")

    max_loops = int(os.getenv("ORCHESTRATOR_AUTOPILOT_MAX_LOOPS", "100"))
    sleep_seconds = int(os.getenv("ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS", "5"))

    for i in range(1, max_loops + 1):
        print(f"\n[autopilot] === Iteration {i} ===")

        # 1) Try to dispatch the next WBS task
        print("[autopilot] Dispatching next task with `python -m orchestrator.cli run-next` ...")
        proc_run = run_py_module("orchestrator.cli", "run-next", capture=True)
        output = (proc_run.stdout or "") + (proc_run.stderr or "")
        print(output, end="")

        # If no unblocked tasks, try an AI sweep of in-progress items
        if "No unblocked todo items found." in output:
            print("[autopilot] No unblocked todo items found on first try; attempting AI sweep of in_progress tasks...")
            proc_sweep = run_py_module("orchestrator.review_all_in_progress", capture=True)
            sweep_output = (proc_sweep.stdout or "") + (proc_sweep.stderr or "")
            print(sweep_output, end="")

            print("[autopilot] Retrying `run-next` after AI sweep ...")
            proc_run = run_py_module("orchestrator.cli", "run-next", capture=True)
            output = (proc_run.stdout or "") + (proc_run.stderr or "")
            print(output, end="")

            if "No unblocked todo items found." in output:
                print("[autopilot] Still no unblocked todo items after AI sweep. Stopping autopilot.")
                break

        if proc_run.returncode != 0:
            print(f"[autopilot] ERROR: run-next exited with {proc_run.returncode}; stopping.")
            print("--- run-next output (for debugging) ---")
            print(output)
            print("---------------------------------------")
            break

        # At this point, a WBS task just ran. Let the brain review it.
        print("[autopilot] Running `python -m orchestrator.review_latest` ...")
        proc_review = run_py_module("orchestrator.review_latest", capture=True)
        print((proc_review.stdout or "") + (proc_review.stderr or ""), end="")
        if proc_review.returncode != 0:
            print(f"[autopilot] WARNING: review_latest exited with {proc_review.returncode}; continuing anyway.")

        print("[autopilot] Running `python -m orchestrator.apply_latest_review` ...")
        proc_apply = run_py_module("orchestrator.apply_latest_review", capture=True)
        print((proc_apply.stdout or "") + (proc_apply.stderr or ""), end="")
        if proc_apply.returncode != 0:
            print(f"[autopilot] WARNING: apply_latest_review exited with {proc_apply.returncode}; continuing anyway.")

        # Optional: update progress (this will warn until we implement orchestrator.update_progress)
        print("[autopilot] Running `python -m orchestrator.update_progress` (if implemented) ...")
        proc_progress = run_py_module("orchestrator.update_progress", capture=True)
        if proc_progress.returncode != 0:
            print("[autopilot] NOTE: update_progress not implemented or failed; this is expected until we add it.")
            # You can comment this out later if you want a clean loop.
        else:
            print((proc_progress.stdout or "") + (proc_progress.stderr or ""), end="")

        # Finally, commit & push changes so Git stays in sync
        print("[autopilot] Running `python -m orchestrator.commit_and_push` ...")
        proc_git = run_py_module("orchestrator.commit_and_push", capture=True)
        print((proc_git.stdout or "") + (proc_git.stderr or ""), end="")
        if proc_git.returncode != 0:
            print(f"[autopilot] WARNING: commit_and_push exited with {proc_git.returncode}; continuing anyway.")

        print(f"[autopilot] Sleeping {sleep_seconds}s before next iteration ...")
        time.sleep(sleep_seconds)

    print("[autopilot] Autopilot loop finished.")


if __name__ == "__main__":
    main()
