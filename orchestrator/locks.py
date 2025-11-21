import os
import time
import pathlib

LOCK_DIR = pathlib.Path("ops/locks")
LOCK_TTL_SECS = int(os.getenv("LOCK_TTL_SECS", "1800"))  # 30 minutes default

def sweep_stale_locks(now=None, ttl=LOCK_TTL_SECS):
    now = time.time() if now is None else now
    LOCK_DIR.mkdir(parents=True, exist_ok=True)
    swept = []
    for p in LOCK_DIR.glob("*.lock"):
        try:
            age = now - p.stat().st_mtime
            if age > ttl:
                p.unlink(missing_ok=True)
                swept.append(p.name)
        except FileNotFoundError:
            # Race: file disappeared; ignore
            pass
    return swept
