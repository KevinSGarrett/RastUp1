from __future__ import annotations
import os
import re
import subprocess
import sys
import time
from datetime import datetime, UTC, timedelta
from pathlib import Path
from typing import Dict, List

# --------------------------------------------------------------------
# Root & logs
# --------------------------------------------------------------------

ROOT = Path(os.getenv("RASTUP_REPO_ROOT") or Path(__file__).resolve().parent.parent)
LOGS = ROOT / "logs"
LOGS.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------

def run(args: List[str], capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=capture, env=os.environ.copy())

def run_py_module(mod: str, *args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return run([sys.executable, "-m", mod, *args], capture=capture)

def has_connect_error(s: str) -> bool:
    s = s.lower()
    return any(tok in s for tok in ("connecterror", "protocol_error", "timeout", "connection refused"))

def _ensure_stub_if_sdks_missing() -> None:
    """
    If OpenAI/Anthropic SDKs aren't importable, force stubbed review to avoid loop crashes.
    """
    def _have(mod: str) -> bool:
        try:
            __import__(mod)
            return True
        except Exception:
            return False
    if not (_have("openai") or _have("anthropic")):
        os.environ.setdefault("ORCHESTRATOR_LLM_STUB", "1")

def _load_queue() -> List[Dict]:
    q = ROOT / "ops" / "queue.jsonl"
    if not q.exists():
        return []
    out: List[Dict] = []
    for line in q.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            pass
    return out

def _write_queue(items: List[Dict]) -> None:
    q = ROOT / "ops" / "queue.jsonl"
    with q.open("w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")

def _find_any_run_report_for_wbs(wbs_id: str) -> bool:
    """
    Scan docs/runs/** for a filename containing the WBS id, e.g. 'WBS-017'.
    """
    runs_root = ROOT / "docs" / "runs"
    if not runs_root.exists():
        return False
    rx = re.compile(re.escape(wbs_id), re.IGNORECASE)
    for p in runs_root.rglob("*.md"):
        if rx.search(p.name):
            return True
    return False

def _sweep_in_progress_requeue_if_stuck() -> List[str]:
    """
    If there are 'in_progress' tasks with no run report at all, reset them to 'todo'
    so the orchestrator can re-dispatch. This mirrors the recovery behavior in your logs.
    """
    changed: List[str] = []
    items = _load_queue()
    if not items:
        return changed

    for it in items:
        if it.get("status") != "in_progress":
            continue
        wbs_id = it.get("task_id", "")
        if not wbs_id:
            continue
        if not _find_any_run_report_for_wbs(wbs_id):
            it["status"] = "todo"
            changed.append(wbs_id)

    if changed:
        _write_queue(items)
    return changed

def _git_sync() -> None:
    if os.getenv("ORCHESTRATOR_AUTOPILOT_GIT", "1") != "1":
        return
    try:
        # stage/commit/push if there are changes
        run(["git", "add", "."], capture=False)
        status = run(["git", "status", "--porcelain"], capture=True).stdout.strip()
        if status:
            msg = f"chore(autopilot): orchestrator sync\n\n{datetime.now(UTC).isoformat()}"
            run(["git", "commit", "-m", msg], capture=False)
            run(["git", "push", "origin", "HEAD"], capture=False)
    except Exception as e:
        print(f"[autopilot] WARN: git sync failed: {e!r}")

# json is needed by queue helpers
import json  # noqa: E402

# --------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------

def main():
    print(f"[autopilot] Starting orchestrator autopilot loop. ROOT={ROOT}")
    max_loops = int(os.getenv("ORCHESTRATOR_AUTOPILOT_MAX_LOOPS", "100"))
    sleep_s = int(os.getenv("ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS", "10"))

    # If SDKs aren't installed yet, keep the loop alive with stubbed reviews
    _ensure_stub_if_sdks_missing()

    for i in range(1, max_loops + 1):
        print(f"\n[autopilot] === Iteration {i} ===")

        # 1) Dispatch next task
        try:
            print("[autopilot] Dispatching next task with `python -m orchestrator.cli run-next` ...")
            attempt = 0
            while True:
                attempt += 1
                proc = run_py_module("orchestrator.cli", "run-next", capture=True)
                txt = (proc.stdout or "") + (proc.stderr or "")
                print(txt, end="")

                if "No unblocked todo items found." in txt:
                    # Recovery path like in your transcripts
                    print("[autopilot] No unblocked todo items found on first try; attempting in-progress sweep ...")
                    res = _sweep_in_progress_requeue_if_stuck()
                    if res:
                        print("[autopilot] Re-queued stuck items:", ", ".join(res))
                        # Try once more now that items were reset
                        continue
                    else:
                        print("[autopilot] Sweep found nothing to re-queue.")
                if proc.returncode == 0 and not has_connect_error(txt):
                    break
                if attempt >= 3:
                    print("[autopilot] WARN: run-next failed repeatedly; continuing.")
                    break
                backoff = min(30, attempt * 5)
                print(f"[autopilot] run-next error; retrying in {backoff}s ...")
                time.sleep(backoff)
        except Exception as e:
            print(f"[autopilot] WARN: run-next raised {e!r}; continuing.")

        # 2) Review the latest run (assistant-manager + primary-decider)
        try:
            print("[autopilot] Running `python -m orchestrator.review_latest` ...")
            run_py_module("orchestrator.review_latest")
        except Exception as e:
            print(f"[autopilot] WARN: review_latest raised {e!r}; continuing.")

        # 3) Apply the decision (accept/reject → queue updates)
        try:
            print("[autopilot] Running `python -m orchestrator.apply_latest_review` ...")
            run_py_module("orchestrator.apply_latest_review")
        except Exception as e:
            print(f"[autopilot] WARN: apply_latest_review raised {e!r}; continuing.")

        # 4) Optional git sync like in your previous logs
        try:
            print("[autopilot] Running optional git sync ...")
            _git_sync()
        except Exception as e:
            print(f"[autopilot] WARN: git sync raised {e!r}; continuing.")

        print(f"[autopilot] Sleeping {sleep_s}s ...")
        time.sleep(sleep_s)

    print("[autopilot] Autopilot loop finished.")

if __name__ == "__main__":
    main()
