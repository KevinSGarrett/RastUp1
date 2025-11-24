# orchestrator/commit_and_push.py
from __future__ import annotations

"""
Robust commit+push for the orchestrator pipeline.

What this fixes:
- Automatically sets upstream on first push when the branch has no tracking remote.
- Clear, actionable errors if "origin" is missing (override via ORCHESTRATOR_GIT_REMOTE).
- Skips committing when nothing is staged (safe no-op).
- Keeps WBS-aware commit messages (derives from the latest run report in docs/runs).

Env overrides:
- ORCHESTRATOR_GIT_REMOTE     (default: "origin")
- ORCHESTRATOR_GIT_PUSH       (default: "1"; set to "0" to skip pushing)
"""

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
RUN_REPORTS_DIR = ROOT / "docs" / "runs"


@dataclass
class RunReport:
    path: Path
    modified_at: float


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    """Run a git command in the repo root and stream output."""
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        check=check,
        text=True,
    )


def git_capture(*args: str, check: bool = True) -> Tuple[int, str, str]:
    """Run a git command and capture stdout/stderr."""
    proc = subprocess.run(
        ["git", "-C", str(ROOT), *args],
        check=False,
        text=True,
        capture_output=True,
    )
    if check and proc.returncode != 0:
        raise subprocess.CalledProcessError(
            proc.returncode, proc.args, proc.stdout, proc.stderr
        )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def current_branch() -> Optional[str]:
    rc, out, _ = git_capture("rev-parse", "--abbrev-ref", "HEAD", check=False)
    return out if rc == 0 and out else None


def has_upstream(branch: str) -> bool:
    rc, out, _ = git_capture(
        "rev-parse", "--abbrev-ref", f"{branch}@{{upstream}}", check=False
    )
    return rc == 0 and bool(out)


def remote_exists(name: str) -> bool:
    rc, out, _ = git_capture("remote", check=False)
    remotes = {r.strip() for r in out.splitlines() if r.strip()}
    return name in remotes


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
    # exit code 0 -> no diff; non-zero -> there *is* a diff
    result = git("diff", "--cached", "--quiet", check=False)
    return result.returncode != 0


def main() -> None:
    remote = os.getenv("ORCHESTRATOR_GIT_REMOTE", "origin")
    do_push = os.getenv("ORCHESTRATOR_GIT_PUSH", "1") != "0"

    print("[orchestrator.commit_and_push] git status (before):")
    git("status", "--short", check=False)

    # Stage everything that isn't ignored (.gitignore filters .venv, etc.)
    print("[orchestrator.commit_and_push] staging changes with `git add .` ...")
    git("add", ".")

    if not has_staged_changes():
        print(
            "[orchestrator.commit_and_push] No staged changes; nothing to commit."
        )
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
    print(
        "[orchestrator.commit_and_push] committing with message:\n"
        f"{commit_message!r}"
    )
    git("commit", "-m", commit_message)

    if not do_push:
        print(
            "[orchestrator.commit_and_push] "
            "ORCHESTRATOR_GIT_PUSH=0 → skipping push."
        )
        return

    if not remote_exists(remote):
        print(
            f"[orchestrator.commit_and_push] ERROR: remote '{remote}' "
            "does not exist."
        )
        print("  - Configure your remote first, e.g.:")
        print(f"    git -C {ROOT} remote add {remote} <your-repo-url>")
        raise SystemExit(2)

    branch = current_branch()
    if not branch:
        print(
            "[orchestrator.commit_and_push] ERROR: could not determine "
            "current branch."
        )
        raise SystemExit(2)

    print(
        f"[orchestrator.commit_and_push] pushing to {remote}/{branch} "
        "(uses your existing auth)..."
    )
    try:
        if has_upstream(branch):
            git("push", remote, branch)
        else:
            # first push for this branch: set upstream automatically
            print(
                "[orchestrator.commit_and_push] no upstream; setting "
                f"upstream: {remote}/{branch}"
            )
            git("push", "--set-upstream", remote, branch)
    except subprocess.CalledProcessError as exc:
        # Report a clear message but keep original stderr for debugging.
        print(
            "[orchestrator.commit_and_push] ERROR: git push failed: "
            f"returncode={exc.returncode}"
        )
        raise

    print("[orchestrator.commit_and_push] Done. git status (after):")
    git("status", "--short", check=False)


if __name__ == "__main__":
    main()
