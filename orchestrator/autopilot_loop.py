from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import List, Optional


# ---------- Root detection ----------

def resolve_root() -> Path:
    """
    Resolve the repo root in a way that works in WSL or PowerShell:

    1) $RASTUP_REPO_ROOT environment variable (highest precedence)
    2) Two levels up from this file: orchestrator/autopilot_loop.py -> repo root
    """
    env_root = os.getenv("RASTUP_REPO_ROOT")
    if env_root:
        return Path(env_root).expanduser().resolve()
    return Path(__file__).resolve().parents[1]


ROOT = resolve_root()
LOGS = ROOT / "logs"
LOGS.mkdir(parents=True, exist_ok=True)


# ---------- Subprocess helpers ----------

def run(
    args: List[str],
    capture: bool = False,
    timeout: Optional[int] = None,
) -> subprocess.CompletedProcess[str]:
    """
    Run a subprocess in the repo root, optionally capturing stdout/stderr.
    """
    return subprocess.run(
        args,
        cwd=str(ROOT),
        text=True,
        capture_output=capture,
        timeout=timeout,
    )


def run_py_module(
    mod: str,
    *args: str,
    capture: bool = False,
    timeout: Optional[int] = None,
) -> subprocess.CompletedProcess[str]:
    """
    Helper to run `python -m <mod> [args...]` under the repo root.
    """
    return run([sys.executable, "-m", mod, *args], capture=capture, timeout=timeout)


# ---------- Queue + runs helpers ----------

def _queue_path() -> Path:
    return ROOT / "ops" / "queue.jsonl"


def _has_any_run_report_for(wbs_id: str) -> bool:
    """
    Return True if *any* run report exists whose filename contains the WBS id.
    This is intentionally crude but matches your earlier behavior.
    """
    runs_dir = ROOT / "docs" / "runs"
    if not runs_dir.exists():
        return False
    pattern = re.compile(re.escape(wbs_id), re.IGNORECASE)
    for p in runs_dir.rglob("*.md"):
        if pattern.search(p.name):
            return True
    return False


def sweep_in_progress_without_reports() -> None:
    """
    If a queue item is stuck in 'in_progress' but we cannot find any run report
    at all for its WBS id, reset it to 'todo' so it can be picked up again.

    This mirrors the behavior you captured in earlier working autopilot logs:
    the loop doesn't stall forever on phantom in-progress items.
    """
    qp = _queue_path()
    if not qp.exists():
        return

    lines = [l for l in qp.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not lines:
        return

    items = [json.loads(l) for l in lines]
    changed = False

    for it in items:
        if it.get("status") != "in_progress":
            continue
        wbs_id = it.get("task_id")
        if not wbs_id:
            continue
        if not _has_any_run_report_for(wbs_id):
            print(
                f"[review_all_in_progress] No run report found for {wbs_id}; "
                f"resetting status to todo so it can be re-run."
            )
            it["status"] = "todo"
            changed = True

    if changed:
        qp.write_text(
            "\n".join(json.dumps(it, ensure_ascii=False) for it in items),
            encoding="utf-8",
        )


# ---------- Main loop ----------

def main() -> None:
    print(f"[autopilot] Starting orchestrator autopilot loop. ROOT={ROOT}")

    max_loops = int(os.getenv("ORCHESTRATOR_AUTOPILOT_MAX_LOOPS", "100"))
    sleep_s = int(os.getenv("ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS", "10"))

    for i in range(1, max_loops + 1):
        print(f"\n[autopilot] === Iteration {i} ===")

        # 1) Dispatch next task
        try:
            print(
                "[autopilot] Dispatching next task with "
                "`python -m orchestrator.cli run-next` ..."
            )
            # We rely on cwd=ROOT, so no need to pass --root; that was causing
            # `cli.py: error: unrecognized arguments: --root /mnt/c/RastUp1`.
            proc = run_py_module(
                "orchestrator.cli",
                "run-next",
                capture=True,
            )
            txt = (proc.stdout or "") + (proc.stderr or "")
            sys.stdout.write(txt)

            if "No unblocked todo items found." in txt:
                print(
                    "[autopilot] No unblocked todo items found; "
                    "attempting sweep of in_progress items without run reports..."
                )
                sweep_in_progress_without_reports()
                print("[autopilot] Sweep complete. Retrying `run-next` once ...")
                proc = run_py_module(
                    "orchestrator.cli",
                    "run-next",
                    capture=True,
                )
                txt2 = (proc.stdout or "") + (proc.stderr or "")
                sys.stdout.write(txt2)

        except Exception as e:
            print(f"[autopilot] WARN: run-next raised {e!r}; continuing.")

        # 2) Review latest run (best-effort)
        try:
            print(
                "[autopilot] Running `python -m orchestrator.review_latest` ..."
            )
            run_py_module("orchestrator.review_latest", capture=False)
        except Exception as e:
            print(
                f"[autopilot] WARN: review_latest raised {e!r}; continuing."
            )

        # 3) Apply latest review (best-effort)
        try:
            print(
                "[autopilot] Running `python -m orchestrator.apply_latest_review` ..."
            )
            run_py_module("orchestrator.apply_latest_review", capture=False)
        except Exception as e:
            print(
                f"[autopilot] WARN: apply_latest_review raised {e!r}; continuing."
            )

        # 4) Optional git sync
        try:
            print(
                "[autopilot] Running `python -m orchestrator.commit_and_push` ..."
            )
            run_py_module("orchestrator.commit_and_push", capture=False)
        except Exception as e:
            print(
                f"[autopilot] WARN: commit_and_push raised {e!r}; continuing."
            )

        print(f"[autopilot] Sleeping {sleep_s}s ...")
        try:
            time.sleep(sleep_s)
        except KeyboardInterrupt:
            print("\n[autopilot] Stopping on user request.")
            break

    print("[autopilot] Autopilot loop finished.")


if __name__ == "__main__":
    main()
