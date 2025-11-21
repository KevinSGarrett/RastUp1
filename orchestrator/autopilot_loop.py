from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path


def repo_root() -> Path:
    """
    Determine the repository root.

    Order of precedence:
    1) RASTUP_REPO_ROOT environment variable (if set)
    2) Parent of this file's parent, i.e. .../RastUp1
    """
    env_root = os.getenv("RASTUP_REPO_ROOT")
    if env_root:
        return Path(env_root).expanduser().resolve()
    # orchestrator/autopilot_loop.py -> parent is /orchestrator -> parent.parent is repo root
    return Path(__file__).resolve().parent.parent


ROOT = repo_root()
LOGS = ROOT / "logs"
LOGS.mkdir(parents=True, exist_ok=True)


def run(args: list[str], capture: bool = False, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    """
    Run a subprocess in the repo root.
    """
    return subprocess.run(
        args,
        cwd=str(ROOT),
        text=True,
        capture_output=capture,
        timeout=timeout,
        env=os.environ.copy(),
    )


def run_py_module(mod: str, *args: str, capture: bool = False, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    """
    Convenience wrapper: python -m <mod> [args...]
    """
    return run([sys.executable, "-m", mod, *args], capture=capture, timeout=timeout)


def has_connect_error(s: str) -> bool:
    """
    Heuristic to detect connection/transport issues from stderr/stdout.
    """
    s = s.lower()
    return (
        "connecterror" in s
        or "protocol_error" in s
        or "timeout" in s
        or "timed out" in s
    )


def _queue_path() -> Path:
    return ROOT / "ops" / "queue.jsonl"


def _has_run_report_for(wbs_id: str) -> bool:
    """
    Return True if any run report file in docs/runs/ appears to match this WBS id.
    We only look at filenames, which is cheap and good enough for the sweep.
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
    Look at ops/queue.jsonl and reset any items that are stuck in 'in_progress'
    but have no matching run report back to 'todo'.

    This mirrors the behavior you previously had in your logs where the reviewer
    would re-queue WBS items that never produced run reports.
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

        if not _has_run_report_for(wbs_id):
            print(
                f"[review_all_in_progress] No run report found for {wbs_id}; "
                "resetting status to todo so it can be re-run."
            )
            it["status"] = "todo"
            changed = True

    if changed:
        qp.write_text(
            "\n".join(json.dumps(it, ensure_ascii=False) for it in items),
            encoding="utf-8",
        )


def main() -> None:
    print(f"[autopilot] Starting orchestrator autopilot loop. ROOT={ROOT}")

    max_loops = int(os.getenv("ORCHESTRATOR_AUTOPILOT_MAX_LOOPS", "100"))
    sleep_s = int(os.getenv("ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS", "10"))

    for i in range(1, max_loops + 1):
        print(f"\n[autopilot] === Iteration {i} ===")

        # 1) Dispatch next task via orchestrator.cli run-next
        try:
            print("[autopilot] Dispatching next task with `python -m orchestrator.cli run-next` ...")
            attempt = 0

            while True:
                attempt += 1
                proc = run_py_module("orchestrator.cli", "run-next", capture=True)
                txt = (proc.stdout or "") + (proc.stderr or "")
                sys.stdout.write(txt)

                # If the queue looks blocked, sweep in_progress without run reports, then retry once
                if "No unblocked todo items found." in txt:
                    print(
                        "[autopilot] No unblocked todo items found; "
                        "attempting sweep of in_progress items without run reports..."
                    )
                    sweep_in_progress_without_reports()
                    print("[autopilot] Sweep complete. Retrying `run-next` once ...")
                    proc = run_py_module("orchestrator.cli", "run-next", capture=True)
                    txt = (proc.stdout or "") + (proc.stderr or "")
                    sys.stdout.write(txt)
                    break

                # Success with no obvious transport error
                if proc.returncode == 0 and not has_connect_error(txt):
                    break

                # Too many failures, give up this iteration
                if attempt >= 3:
                    print("[autopilot] WARN: run-next failed repeatedly; continuing.")
                    break

                backoff = min(30, attempt * 5)
                print(f"[autopilot] run-next error; retrying in {backoff}s ...")
                time.sleep(backoff)

        except Exception as e:
            print(f"[autopilot] WARN: run-next raised {e!r}; continuing.")

        # 2) Review latest run report (best-effort)
        try:
            print("[autopilot] Running `python -m orchestrator.review_latest` ...")
            run_py_module("orchestrator.review_latest", capture=False)
        except Exception as e:
            print(f"[autopilot] WARN: review_latest raised {e!r}; continuing.")

        # 3) Apply latest review (best-effort)
        try:
            print("[autopilot] Running `python -m orchestrator.apply_latest_review` ...")
            run_py_module("orchestrator.apply_latest_review", capture=False)
        except Exception as e:
            print(f"[autopilot] WARN: apply_latest_review raised {e!r}; continuing.")

        # 4) Optional git sync (best-effort)
        try:
            print("[autopilot] Running `python -m orchestrator.commit_and_push` ...")
            run_py_module("orchestrator.commit_and_push", capture=False)
        except Exception as e:
            print(f"[autopilot] WARN: commit_and_push raised {e!r}; continuing.")

        print(f"[autopilot] Sleeping {sleep_s}s ...")
        try:
            time.sleep(sleep_s)
        except KeyboardInterrupt:
            print("\n[autopilot] Stopping on user request.")
            break

    print("[autopilot] Autopilot loop finished.")


if __name__ == "__main__":
    main()
