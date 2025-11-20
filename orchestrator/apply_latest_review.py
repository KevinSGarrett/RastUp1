from __future__ import annotations
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REVIEWS = ROOT / "docs" / "orchestrator" / "reviews"
RUNS = ROOT / "docs" / "runs"

def sh(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True)

def latest_review() -> tuple[Path, str]:
    if not REVIEWS.exists():
        raise SystemExit("no reviews dir")
    cands = sorted(REVIEWS.glob("orchestrator-review-*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not cands:
        raise SystemExit("no reviews found")
    p = cands[0]
    return p, p.read_text(encoding="utf-8", errors="ignore")

def run_ci() -> bool:
    proc = sh(["make", "ci"])
    sys.stdout.write(proc.stdout or "")
    sys.stderr.write(proc.stderr or "")
    return proc.returncode == 0

def apply():
    p, body = latest_review()
    m = re.search(r"(WBS-\d+)", p.name); wbs = m.group(1) if m else None
    if not wbs: raise SystemExit("no WBS in review filename")

    decision = "in_progress"
    dm = re.search(r"Decision:\s*(done|in_progress)", body, re.IGNORECASE)
    if dm: decision = dm.group(1).lower()

    run_report_exists = any(RUNS.glob(f"*{wbs}*.md"))
    acceptance_met = bool(re.search(r"ACCEPTANCE:\s*met", body, re.IGNORECASE))
    ok_ci = run_ci()

    status = "done" if (run_report_exists and ok_ci and acceptance_met and decision == "done") else "in_progress"
    sh(["python", "-m", "orchestrator.task_status", "set", "--id", wbs, "--status", status])
    print(f"[apply_latest_review] {wbs} -> {status} (report={run_report_exists}, ci={ok_ci}, acceptance={acceptance_met}, decision={decision})")

if __name__ == "__main__":
    apply()
