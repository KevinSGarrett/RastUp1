# orchestrator/autopilot_loop.py
from __future__ import annotations
import os
import subprocess
import sys
import time
from pathlib import Path

def _root() -> Path:
    return Path(os.getenv("RASTUP_REPO_ROOT") or Path(__file__).resolve().parent.parent)

ROOT = _root()
LOGS = ROOT / "logs"
LOGS.mkdir(parents=True, exist_ok=True)

def run(args: list[str], capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=str(ROOT), text=True, capture_output=capture)

def run_py(mod: str, *args: str, capture: bool = False):
    # always forward --root so all modules operate under the same project folder
    return run([sys.executable, "-m", mod, "--root", str(ROOT), *args], capture=capture)

def has_connect_error(s: str) -> bool:
    s = s.lower()
    return "connecterror" in s or "protocol_error" in s or "timeout" in s

def main():
    print(f"[autopilot] Starting orchestrator autopilot loop. ROOT={ROOT}")
    max_loops = int(os.getenv("ORCHESTRATOR_AUTOPILOT_MAX_LOOPS", "100"))
    sleep_s = int(os.getenv("ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS", "10"))

    for i in range(1, max_loops + 1):
        print(f"\n[autopilot] === Iteration {i} ===")
        try:
            print("[autopilot] Dispatching next task with `python -m orchestrator.cli run-next` ...")
            attempt = 0
            while True:
                attempt += 1
                proc = run_py("orchestrator.cli", "run-next", capture=True)
                txt = (proc.stdout or "") + (proc.stderr or "")
                print(txt, end="")
                if "No unblocked todo items found." in txt:
                    # Try to unstick the queue by sweeping in_progress items without reports.
                    print("[autopilot] No unblocked todo items found; running `sweep-inprogress` ...")
                    proc2 = run_py("orchestrator.cli", "sweep-inprogress", capture=True)
                    txt2 = (proc2.stdout or "") + (proc2.stderr or "")
                    print(txt2, end="")
                    # and immediately retry run-next once
                    proc = run_py("orchestrator.cli", "run-next", capture=True)
                    txt = (proc.stdout or "") + (proc.stderr or "")
                    print(txt, end="")
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

        # Reviews and application step (resilient to missing modules)
        try:
            print("[autopilot] Running `python -m orchestrator.review_latest` ...")
            run_py("orchestrator.review_latest")
        except Exception as e:
            print(f"[autopilot] WARN: review_latest raised {e!r}; continuing.")
        try:
            print("[autopilot] Running `python -m orchestrator.apply_latest_review` ...")
            run_py("orchestrator.apply_latest_review")
        except Exception as e:
            print(f"[autopilot] WARN: apply_latest_review raised {e!r}; continuing.")

        # Optional git sync if you have a helper module
        try:
            print("[autopilot] Running optional git sync ...")
            run_py("orchestrator.commit_and_push")
        except Exception:
            pass

        print(f"[autopilot] Sleeping {sleep_s}s ...")
        time.sleep(sleep_s)

    print("[autopilot] Autopilot loop finished.")

if __name__ == "__main__":
    main()
