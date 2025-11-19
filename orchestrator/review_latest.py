from __future__ import annotations
import argparse, json, os, re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from openai import OpenAI

ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = ROOT / "docs" / "runs"
REVIEWS_DIR = ROOT / "docs" / "orchestrator" / "reviews"
FROM_AGENTS = ROOT / "docs" / "orchestrator" / "from-agents"

@dataclass
class RunReport:
    wbs: str
    path: Path
    modified_at: float

def _pick_latest(cands: list[Path]) -> Optional[RunReport]:
    if not cands: return None
    p = max(cands, key=lambda x: x.stat().st_mtime)
    m = re.search(r"(WBS-\d+)", p.name)
    wbs = m.group(1) if m else "WBS-UNKNOWN"
    return RunReport(wbs=wbs, path=p, modified_at=p.stat().st_mtime)

def _find_for_wbs(wbs: str) -> Optional[RunReport]:
    cands = []
    if RUNS_DIR.exists():
        cands += [p for p in RUNS_DIR.glob(f"*{wbs}*.md")]
    if FROM_AGENTS.exists():
        cands += [p for p in FROM_AGENTS.glob("AGENT-*/*/run-report.md")]
        cands += [p for p in FROM_AGENTS.glob("AGENT-*/*/*.md") if wbs in p.name]
    return _pick_latest(cands)

def _find_latest_any() -> Optional[RunReport]:
    cands = []
    if RUNS_DIR.exists():
        cands += list(RUNS_DIR.glob("*.md"))
    if FROM_AGENTS.exists():
        cands += [p for p in FROM_AGENTS.glob("AGENT-*/*/run-report.md")]
        cands += [p for p in FROM_AGENTS.glob("AGENT-*/*/*.md")]
    return _pick_latest(cands)

def call_openai(model: str, system_prompt: str, user_content: str) -> str:
    client = OpenAI()
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role":"system","content":system_prompt},
            {"role":"user","content":user_content},
        ],
    )
    return resp.choices[0].message.content

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wbs", default=None, help="e.g., WBS-005")
    ap.add_argument("--model", default=os.getenv("ORCHESTRATOR_MODEL_HIGH","gpt-4.1"))
    args = ap.parse_args()

    rr = _find_for_wbs(args.wbs) if args.wbs else _find_latest_any()
    if not rr:
        print("[orchestrator.review_latest] No run report found.")
        return

    text = rr.path.read_text(encoding="utf-8", errors="replace")
    system = "You are the Orchestrator Auditor. Produce a crisp, actionable status verdict."
    user = f"Run report for {rr.wbs}:\n\n{text}"

    md = call_openai(args.model, system, user)

    REVIEWS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
    out = REVIEWS_DIR / f"orchestrator-review-{rr.wbs}-{ts}.md"
    out.write_text(md, encoding="utf-8")
    print(f"[orchestrator.review_latest] {rr.wbs} -> {out}")
if __name__ == "__main__":
    main()
