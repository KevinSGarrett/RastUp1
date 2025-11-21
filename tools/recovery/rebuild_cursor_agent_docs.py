# tools/recovery/rebuild_cursor_agent_docs.py
from pathlib import Path
import json, shutil

root = Path("docs/orchestrator/from-agents")
out = Path("ops/agents")
out.mkdir(parents=True, exist_ok=True)

for agent_dir in root.glob("AGENT-*"):
    agent_id = agent_dir.name
    newest = max(agent_dir.glob("run-*"), default=None, key=lambda p: p.name)
    if not newest: continue
    rr = newest / "run-report.md"
    if rr.exists():
        a = out / agent_id
        a.mkdir(exist_ok=True, parents=True)
        (a / "charter.md").write_text(rr.read_text())
