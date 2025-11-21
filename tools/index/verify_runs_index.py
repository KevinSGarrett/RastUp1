#!/usr/bin/env python3
# tools/index/verify_runs_index.py
import csv, json, re, sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional

RUNS_DIR = Path("docs/runs")
AGENT_ROOT = Path("docs/orchestrator/from-agents")
REVIEWS_DIR = Path("docs/orchestrator/reviews")
QUEUE = Path("ops/queue.jsonl")

RUN_FILE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-WBS-(\d+)-AGENT-(\d+).*\.md$")
REVIEW_FILE_RE = re.compile(r"^orchestrator-review-WBS-(\d+)-(\d{8}-\d{6}Z)\.md$")

@dataclass
class RunRow:
    date: str
    wbs: str
    agent: str
    run_report: str
    artifacts_dir: Optional[str]
    attach_zip: Optional[str]
    review_files: List[str]
    wbs_status: Optional[str]

def read_queue_statuses() -> Dict[str, str]:
    statuses = {}
    if not QUEUE.exists():
        return statuses
    with QUEUE.open() as f:
        for line in f:
            try:
                obj = json.loads(line)
                if "id" in obj and "status" in obj:
                    statuses[obj["id"]] = obj["status"]
            except Exception:
                pass
    return statuses

def find_agent_artifacts(wbs: str) -> (Optional[Path], Optional[Path]):
    # AGENT-*/run-YYYYMMDDTHHMMSSZ/
    candidates = []
    if AGENT_ROOT.exists():
        for agent_dir in AGENT_ROOT.glob("AGENT-*"):
            for run_dir in agent_dir.glob("run-*"):
                z = run_dir.with_name(run_dir.name + "-attach.zip")
                if run_dir.exists():
                    candidates.append((run_dir, z if z.exists() else None))
    # pick the most recent that mentions this WBS in run-report name or manifest
    for run_dir, zip_path in sorted(candidates, key=lambda t: t[0].name, reverse=True):
        rr = run_dir / "run-report.md"
        if rr.exists():
            txt = rr.read_text(errors="ignore")
            if f"WBS-{wbs}" in txt:
                return run_dir, zip_path
    return None, None

def main():
    statuses = read_queue_statuses()
    rows: List[RunRow] = []

    if not RUNS_DIR.exists():
        print("No docs/runs directory", file=sys.stderr)
        sys.exit(2)

    for f in sorted(RUNS_DIR.glob("*.md")):
        m = RUN_FILE_RE.match(f.name)
        if not m:
            continue
        wbs, agent = m.group(1), m.group(2)
        date = f.name[:10]
        artifacts_dir, attach_zip = find_agent_artifacts(wbs)
        reviews = []
        if REVIEWS_DIR.exists():
            for r in REVIEWS_DIR.glob(f"orchestrator-review-WBS-{wbs}-*.md"):
                if REVIEW_FILE_RE.match(r.name):
                    reviews.append(str(r))
        rows.append(
            RunRow(
                date=date,
                wbs=f"WBS-{wbs}",
                agent=f"AGENT-{agent}",
                run_report=str(f),
                artifacts_dir=str(artifacts_dir) if artifacts_dir else None,
                attach_zip=str(attach_zip) if attach_zip else None,
                review_files=reviews,
                wbs_status=statuses.get(f"WBS-{wbs}")
            )
        )

    # Sanity checks
    missing_artifacts = [r for r in rows if not r.artifacts_dir]
    if missing_artifacts:
        print("ERROR: Missing artifacts for:", [r.wbs for r in missing_artifacts], file=sys.stderr)

    # Emit CSV and Markdown
    out_dir = Path("docs/orchestrator/_index")
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "runs_index.csv"
    md_path = out_dir / "runs_index.md"

    with csv_path.open("w", newline="") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=list(asdict(rows[0]).keys()) if rows else [
            "date","wbs","agent","run_report","artifacts_dir","attach_zip","review_files","wbs_status"
        ])
        writer.writeheader()
        for r in rows:
            d = asdict(r)
            d["review_files"] = ";".join(r.review_files)
            writer.writerow(d)

    with md_path.open("w") as md:
        md.write("| date | wbs | agent | run_report | artifacts_dir | attach_zip | reviews | wbs_status |\n")
        md.write("|---|---|---|---|---|---|---|---|\n")
        for r in rows:
            md.write(f"| {r.date} | {r.wbs} | {r.agent} | {r.run_report} | {r.artifacts_dir or ''} | "
                     f"{r.attach_zip or ''} | {len(r.review_files)} file(s) | {r.wbs_status or ''} |\n")

    # Exit non-zero if anything is missing so CI can fail
    if missing_artifacts:
        sys.exit(3)

if __name__ == "__main__":
    main()
