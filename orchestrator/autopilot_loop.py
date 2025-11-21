from __future__ import annotations
import os
import subprocess
import sys
import time
from pathlib import Path

def repo_root() -> Path:
    # Honor env, otherwise use package parent, otherwise cwd
    env_root = os.getenv("RASTUP_REPO_ROOT")
    if env_root:
        return Path(env_root).resolve()
    # When run as module, __file__ is this file
    return Path(__file__).resolve().parent.parent

ROOT = repo_root()
LOGS = ROOT / "logs"
LOGS.mkdir(parents=True, exist_ok=True)

def run(args: list[str], capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(ROOT),
        text=True,
        capture_output=capture,
        env=os.environ.copy()
    )

def run_py_module(mod: str, *args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return run([sys.executable, "-m", mod, *args], capture=capture)

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
                proc = run_py_module("orchestrator.cli", "run-next", capture=True)
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

        # Review latest report (no --root; cwd is already ROOT)
        try:
            print("[autopilot] Running `python -m orchestrator.review_latest` ...")
            run_py_module("orchestrator.review_latest")
        except Exception as e:
            print(f"[autopilot] WARN: review_latest raised {e!r}; continuing.")

        # Apply reviewer’s decision if you have that module
        try:
            print("[autopilot] Running `python -m orchestrator.apply_latest_review` ...")
            run_py_module("orchestrator.apply_latest_review")
        except Exception as e:
            print(f"[autopilot] WARN: apply_latest_review raised {e!r}; continuing.")

        # Optional git sync
        try:
            print("[autopilot] Running optional git sync ...")
            run_py_module("orchestrator.commit_and_push")
        except Exception:
            pass

        print(f"[autopilot] Sleeping {sleep_s}s ...")
        time.sleep(sleep_s)

    print("[autopilot] Autopilot loop finished.")

if __name__ == "__main__":
    main()
