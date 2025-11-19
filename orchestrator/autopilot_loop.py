from __future__ import annotations
import os, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOGS = ROOT / "logs"
LOGS.mkdir(parents=True, exist_ok=True)

def run(cmd: list[str], capture: bool=False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, text=True, capture_output=capture)

def run_py(mod: str, *args: str, capture: bool=False):
    return run([sys.executable, "-m", mod, *args], capture=capture)

def parse_wbs(s: str) -> str | None:
    m = re.search(r"(WBS-\d+)", s)
    return m.group(1) if m else None

def call_cursor_with_retry():
    # noop placeholder; your orchestrator.cli calls cursor-agent internally
    pass

def main():
    print("[autopilot] Starting orchestrator autopilot loop.")
    max_loops = int(os.getenv("ORCHESTRATOR_AUTOPILOT_MAX_LOOPS","100"))
    sleep_s = int(os.getenv("ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS","5"))

    for i in range(1, max_loops+1):
        print(f"\n[autopilot] === Iteration {i} ===")

        # 0) sweep stale locks
        try:
            out = run_py("orchestrator.locks", capture=True)
            if out.stdout: print(out.stdout.strip())
        except Exception:
            pass

        print("[autopilot] Dispatching next task with `run-next` ...")
        proc_run = run_py("orchestrator.cli", "run-next", capture=True)
        out = (proc_run.stdout or "") + (proc_run.stderr or "")
        print(out, end="")

        if "No unblocked todo items found." in out:
            print("[autopilot] No unblocked todo items found. Stopping autopilot.")
            break

        # Extract current WBS id (for targeted review)
        wbs = parse_wbs(out) or None

        # 1) Reviewer
        try:
            if wbs:
                print(f"[autopilot] Reviewing {wbs} ...")
                run_py("orchestrator.review_latest", f"--wbs={wbs}")
            else:
                print("[autopilot] Reviewing latest (no WBS parsed) ...")
                run_py("orchestrator.review_latest")
        except Exception as e:
            print(f"[autopilot] WARNING: review failed: {e}")

        # 2) Apply review -> flip statuses
        try:
            run_py("orchestrator.apply_latest_review")
        except Exception:
            pass

        # 3) Update PROGRESS.md
        try:
            run_py("orchestrator.update_progress")
        except Exception:
            print("[autopilot] NOTE: update_progress failed.")

        # 4) Commit/push
        try:
            run_py("orchestrator.commit_and_push")
        except Exception as e:
            print(f"[autopilot] WARNING: commit/push failed: {e}")

        print(f"[autopilot] Sleeping {sleep_s}s before next iteration ...")
        time.sleep(sleep_s)

if __name__ == "__main__":
    main()
