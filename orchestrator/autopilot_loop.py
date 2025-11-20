from __future__ import annotations
import os, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOGS = ROOT / "logs"; LOGS.mkdir(parents=True, exist_ok=True)

def run(args: list[str], capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=capture)

def run_py(mod: str, *args: str, capture: bool = False):
    return run([sys.executable, "-m", mod, *args], capture=capture)

def has_connect_error(s: str) -> bool:
    s = s.lower()
    return "connecterror" in s or "protocol_error" in s or "timeout" in s

def main():
    print("[autopilot] Starting orchestrator autopilot loop.")
    max_loops = int(os.getenv("ORCHESTRATOR_AUTOPILOT_MAX_LOOPS", "100"))
    sleep_s = int(os.getenv("ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS", "10"))

    for i in range(1, max_loops + 1):
        print(f"\n[autopilot] === Iteration {i} ===")
        try:
            print("[autopilot] Dispatching next task with `run-next` ...")
            attempt = 0
            while True:
                attempt += 1
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

        try:
            run_py("orchestrator.review_latest")
        except Exception as e:
            print(f"[autopilot] WARN: review_latest raised {e!r}; continuing.")
        try:
            run_py("orchestrator.apply_latest_review")
        except Exception as e:
            print(f"[autopilot] WARN: apply_latest_review raised {e!r}; continuing.")

        print(f"[autopilot] Sleeping {sleep_s}s ...")
        time.sleep(sleep_s)

    print("[autopilot] Autopilot loop finished.")

if __name__ == "__main__":
    main()
