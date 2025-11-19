from __future__ import annotations
from pathlib import Path
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parent.parent
LOCKS = ROOT / "ops" / "locks"

def sweep(ttl_minutes: int = 60) -> list[str]:
    removed = []
    if not LOCKS.exists():
        return removed
    now = datetime.now(timezone.utc).timestamp()
    ttl = ttl_minutes * 60
    for p in LOCKS.glob("*.lock"):
        try:
            age = now - p.stat().st_mtime
            if age > ttl:
                p.unlink(missing_ok=True)
                removed.append(p.name)
        except Exception:
            pass
    return removed

if __name__ == "__main__":
    gone = sweep()
    if gone:
        print("[locks.sweep] removed:", ", ".join(gone))
    else:
        print("[locks.sweep] none removed")
