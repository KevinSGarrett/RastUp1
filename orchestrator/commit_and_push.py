from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


ROOT = Path(__file__).resolve().parent.parent
RUN_REPORTS_DIR = ROOT / "docs" / "runs"


@dataclass
class RunReport:
    path: Path
    modified_at: float


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    """Run a git command in the repo root."""
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        check=check,
    )


def find_latest_run_report() -> Optional[RunReport]:
    if not RUN_REPORTS_DIR.exists():
        return None

    candidates = [p for p in RUN_REPORTS_DIR.glob("*.md") if p.is_file()]
    if not candidates:
        return None

    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    return RunReport(path=latest, modified_at=latest.stat().st_mtime)


def extract_wbs_id(report: RunReport | None) -> Optional[str]:
    if report is None:
        return None

    # Try filename first: e.g. 2025-11-18-WBS-023-AGENT-4.md
    m = re.search(r"(WBS-\d+)", report.path.name)
    if m:
        return m.group(1)

    # Fallback: search inside file contents
    try:
        text = report.path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None

    m = re.search(r"(WBS-\d+)", text)
    return m.group(1) if m else None


def has_staged_changes() -> bool:
    # exit code 0 -> no diff; non‑zero -> there *is* a diff
    result = git("diff", "--cached", "--quiet", check=False)
    return result.returncode != 0


def main() -> None:
    print("[orchestrator.commit_and_push] git status (before):")
    git("status", "--short", check=False)

    # Stage everything that isn't ignored (.gitignore already filters .venv etc.)
    print("[orchestrator.commit_and_push] staging changes with `git add .` ...")
    git("add", ".")

    if not has_staged_changes():
        print("[orchestrator.commit_and_push] No staged changes; nothing to commit.")
        return

    latest = find_latest_run_report()
    wbs_id = extract_wbs_id(latest)

    if wbs_id:
        summary = f"chore({wbs_id.lower()}): orchestrator sync"
        footer = f"\n\nWBS: {wbs_id}\n"
    else:
        summary = "chore: orchestrator sync"
        footer = "\n\nWBS: unknown\n"

    commit_message = summary + footer

    print(f"[orchestrator.commit_and_push] committing with message:\n{commit_message!r}")
    git("commit", "-m", commit_message)

    print("[orchestrator.commit_and_push] pushing to origin (uses your existing auth)...")
    try:
        git("push")
    except subprocess.CalledProcessError as exc:
        print(f"[orchestrator.commit_and_push] ERROR: git push failed: {exc}")
        print("  - Check your network, GitHub status, or remote configuration.")
        raise

    print("[orchestrator.commit_and_push] Done. git status (after):")
    git("status", "--short", check=False)


if __name__ == "__main__":
    main()
