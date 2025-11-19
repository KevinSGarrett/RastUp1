from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUEUE = ROOT / "ops" / "queue.jsonl"
PROGRESS = ROOT / "docs" / "PROGRESS.md"

def read_queue():
    items = []
    if not QUEUE.exists(): return items
    for line in QUEUE.read_text(encoding="utf-8").splitlines():
        if not line.strip(): continue
        try:
            items.append(json.loads(line))
        except Exception:
            pass
    return items

def write_progress(items):
    by = {"done":[], "in_progress":[], "todo":[]}
    for it in items:
        by.get(it.get("status","todo"), []).append(it)
    lines = ["# Progress", ""]
    for sec in ("done","in_progress","todo"):
        lines.append(f"## {sec}")
        if not by[sec]:
            lines.append("- (none)")
        else:
            for it in sorted(by[sec], key=lambda x: x.get("id","")):
                agent = it.get("agent","?")
                title = it.get("title","")
                deps = ",".join(it.get("deps",[])) or "(none)"
                lines.append(f"- **{it['id']}** [{agent}] deps: {deps} — {title}")
        lines.append("")
    PROGRESS.write_text("\n".join(lines), encoding="utf-8")
    print("[update_progress] PROGRESS.md updated.")

if __name__ == "__main__":
    write_progress(read_queue())
