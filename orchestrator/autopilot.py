import time
import random
import subprocess
try:
    from orchestrator.update_progress import write_progress_line  # optional dependency
except Exception:
    def write_progress_line(msg: str) -> None:
        print(msg)

from orchestrator.locks import sweep_stale_locks

def call_with_backoff(fn, *a, **k):
    delay = 1.0
    for attempt in range(5):
        try:
            return fn(*a, **k)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(delay + random.random())
            delay *= 2

def loop(pause_secs: float = 10.0):
    while True:
        swept = sweep_stale_locks()
        if swept:
            write_progress_line(f"swept locks: {', '.join(swept)}")
        subprocess.run(["make", "run-next"], check=False)
        subprocess.run(["python", "-m", "orchestrator.review_latest", "--print-only"], check=False)
        time.sleep(pause_secs)
