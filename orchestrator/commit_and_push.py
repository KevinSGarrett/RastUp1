# orchestrator/commit_and_push.py
from __future__ import annotations

"""
Robust commit+push for the orchestrator pipeline.

Baseline behavior:
- Automatically sets upstream on first push when the branch has no tracking remote.
- Clear, actionable errors if the remote is missing (override via ORCHESTRATOR_GIT_REMOTE).
- Skips committing when nothing is staged (safe no-op).
- Keeps WBS-aware commit messages (derives from the latest run report in docs/runs).

New, opt-in behaviors (controlled via env vars):
- Branch strategy:
    ORCHESTRATOR_GIT_FLOW:
      * "direct"  (default) → commit directly to current branch.
      * "feature"          → commit on a per-WBS feature branch (e.g., wbs-001).
      * "pr"               → like "feature", plus create a PR via `gh` CLI.
- Smarter staging:
    ORCHESTRATOR_STAGE_MODE:
      * "all" (default)    → `git add .`
      * "orchestrator-only"→ only orchestrator-owned paths (see SAFE_PATHS_DEFAULT)
    ORCHESTRATOR_SAFE_PATHS:
      * Optional comma-separated override for the safe paths list.
- PR flow (only when ORCHESTRATOR_GIT_FLOW="pr" and `gh` is available):
    ORCHESTRATOR_GIT_BASE   (default: "main")
    ORCHESTRATOR_GIT_AUTO_MERGE (default: "0"; set to "1" to run `gh pr merge --squash --auto`)

Other env overrides:
- ORCHESTRATOR_GIT_REMOTE     (default: "origin")
- ORCHESTRATOR_GIT_PUSH       (default: "1"; set to "0" to skip pushing)
"""

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple, List

ROOT = Path(__file__).resolve().parent.parent
RUN_REPORTS_DIR = ROOT / "docs" / "runs"

SAFE_PATHS_DEFAULT: List[str] = [
    "docs/orchestrator",
    "docs/runs",
    "docs/PROGRESS.md",
    "docs/TODO_MASTER.md",
    "ops",
    "orchestrator",
    "tools/infra",
    "tests/python/test_infra_tools.py",
]


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
        raise subprocess.CalledProcessError(proc.returncode, proc.args, proc.stdout, proc.stderr)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def current_branch() -> Optional[str]:
    rc, out, _ = git_capture("rev-parse", "--abbrev-ref", "HEAD", check=False)
    return out if rc == 0 and out else None


def has_upstream(branch: str) -> bool:
    rc, out, _ = git_capture("rev-parse", "--abbrev-ref", f"{branch}@{{upstream}}", check=False)
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


def parse_safe_paths_env() -> List[str]:
    raw = os.getenv("ORCHESTRATOR_SAFE_PATHS")
    if not raw:
        return SAFE_PATHS_DEFAULT
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return parts or SAFE_PATHS_DEFAULT


def stage_paths(stage_mode: str, safe_paths: List[str]) -> None:
    """
    Stage changes according to the chosen mode.

    - "all": `git add .`
    - "orchestrator-only": only the provided safe paths.
    """
    if stage_mode == "orchestrator-only":
        print(f"[orchestrator.commit_and_push] staging orchestrator-only paths: {safe_paths}")
        for rel in safe_paths:
            try:
                git("add", rel, check=False)
            except Exception as exc:  # extremely defensive; git will usually just warn
                print(f"[orchestrator.commit_and_push] WARN: could not add {rel!r}: {exc}")
    else:
        print("[orchestrator.commit_and_push] staging changes with `git add .` ...")
        git("add", ".")


def ensure_feature_branch(flow_mode: str, wbs_id: Optional[str]) -> str:
    """
    Ensure we are on the correct branch given the git flow mode.

    - direct: stay on current branch (or "main" if unknown).
    - feature/pr: switch or create `wbs-XXX` branch if a WBS id is available.
    """
    current = current_branch() or "main"

    if flow_mode not in {"feature", "pr"} or not wbs_id:
        return current

    target = wbs_id.lower()

    if target == current:
        return current

    # Does the branch already exist?
    rc, _, _ = git_capture("rev-parse", "--verify", target, check=False)
    if rc == 0:
        print(f"[orchestrator.commit_and_push] switching to existing feature branch {target!r}")
        git("checkout", target)
    else:
        print(
            f"[orchestrator.commit_and_push] creating feature branch {target!r} "
            f"from {current!r}"
        )
        git("checkout", "-b", target)

    return target


# ---------- GitHub CLI / PR helpers (optional) ----------

def _gh_available() -> bool:
    try:
        proc = subprocess.run(
            ["gh", "--version"],
            cwd=str(ROOT),
            text=True,
            capture_output=True,
            check=False,
        )
        return proc.returncode == 0
    except FileNotFoundError:
        return False


def _gh_capture(*args: str, check: bool = True) -> Tuple[int, str, str]:
    proc = subprocess.run(
        ["gh", *args],
        cwd=str(ROOT),
        text=True,
        capture_output=True,
        check=False,
    )
    if check and proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, proc.args, proc.stdout, proc.stderr)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def pr_exists_for_branch(branch: str) -> bool:
    rc, out, err = _gh_capture(
        "pr", "list",
        "--head", branch,
        "--state", "open",
        "--json", "number",
        check=False,
    )
    if rc != 0:
        # If gh returns an error, just treat as "no PR" and log.
        if err:
            print(f"[orchestrator.commit_and_push] gh pr list error: {err}")
        return False

    if not out:
        return False

    try:
        data = json.loads(out)
        return bool(data)
    except Exception:
        # Fallback: any non-empty output means "probably at least one PR".
        return bool(out.strip())


def create_pr(branch: str, base_branch: str, wbs_id: Optional[str]) -> None:
    title = f"{branch}: orchestrator sync"
    wbs_part = f" ({wbs_id})" if wbs_id else ""
    body = (
        f"Automated orchestrator sync for branch `{branch}`{wbs_part}.\n\n"
        "Generated by `orchestrator.commit_and_push`."
    )

    print(f"[orchestrator.commit_and_push] creating PR from {branch!r} to {base_branch!r} via gh ...")
    rc, out, err = _gh_capture(
        "pr", "create",
        "--head", branch,
        "--base", base_branch,
        "--title", title,
        "--body", body,
        check=False,
    )
    if rc != 0:
        print(f"[orchestrator.commit_and_push] gh pr create failed (rc={rc}): {err or out}")
    else:
        print(f"[orchestrator.commit_and_push] gh pr create succeeded: {out or '(no output)'}")


def maybe_merge_pr(auto_merge: bool) -> None:
    if not auto_merge:
        return
    print("[orchestrator.commit_and_push] attempting auto-merge via `gh pr merge --squash --auto` ...")
    rc, out, err = _gh_capture("pr", "merge", "--squash", "--auto", check=False)
    if rc != 0:
        print(f"[orchestrator.commit_and_push] gh pr merge failed (rc={rc}): {err or out}")
    else:
        print(f"[orchestrator.commit_and_push] gh pr merge succeeded: {out or '(no output)'}")


# ---------- Main entrypoint ----------

def main() -> None:
    remote = os.getenv("ORCHESTRATOR_GIT_REMOTE", "origin")
    do_push = os.getenv("ORCHESTRATOR_GIT_PUSH", "1") != "0"
    git_flow = os.getenv("ORCHESTRATOR_GIT_FLOW", "direct").lower()
    stage_mode = os.getenv("ORCHESTRATOR_STAGE_MODE", "all").lower()
    base_branch = os.getenv("ORCHESTRATOR_GIT_BASE", "main")
    safe_paths = parse_safe_paths_env()
    auto_merge_pr = os.getenv("ORCHESTRATOR_GIT_AUTO_MERGE", "0") == "1"

    print("[orchestrator.commit_and_push] git status (before):")
    git("status", "--short", check=False)

    # Determine WBS id (used for commit message + optional branch naming)
    latest = find_latest_run_report()
    wbs_id = extract_wbs_id(latest)

    # Decide which branch to commit on, and switch if needed.
    branch = ensure_feature_branch(git_flow, wbs_id)

    # Stage changes according to mode.
    stage_paths(stage_mode, safe_paths)

    if not has_staged_changes():
        print("[orchestrator.commit_and_push] No staged changes; nothing to commit.")
        return

    # Build commit message.
    if wbs_id:
        summary = f"chore({wbs_id.lower()}): orchestrator sync"
        footer = f"\n\nWBS: {wbs_id}\n"
    else:
        summary = "chore: orchestrator sync"
        footer = "\n\nWBS: unknown\n"

    commit_message = summary + footer
    print(f"[orchestrator.commit_and_push] committing on branch {branch!r} with message:\n{commit_message!r}")
    git("commit", "-m", commit_message)

    if not do_push:
        print("[orchestrator.commit_and_push] ORCHESTRATOR_GIT_PUSH=0 → skipping push.")
        return

    if not remote_exists(remote):
        print(f"[orchestrator.commit_and_push] ERROR: remote '{remote}' does not exist.")
        print("  - Configure your remote first, e.g.:")
        print(f"    git -C {ROOT} remote add {remote} <your-repo-url>")
        raise SystemExit(2)

    branch_after = current_branch()
    if not branch_after:
        print("[orchestrator.commit_and_push] ERROR: could not determine current branch.")
        raise SystemExit(2)

    print(f"[orchestrator.commit_and_push] pushing to {remote}/{branch_after} (uses your existing auth)...")
    try:
        if has_upstream(branch_after):
            git("push", remote, branch_after)
        else:
            # first push for this branch: set upstream automatically
            print(f"[orchestrator.commit_and_push] no upstream; setting upstream: {remote}/{branch_after}")
            git("push", "--set-upstream", remote, branch_after)
    except subprocess.CalledProcessError as exc:
        print(f"[orchestrator.commit_and_push] ERROR: git push failed: returncode={exc.returncode}")
        raise

    # Optional PR flow when using feature branches with gh.
    if git_flow == "pr":
        if not _gh_available():
            print("[orchestrator.commit_and_push] gh CLI not available; skipping PR creation/merge.")
        else:
            if pr_exists_for_branch(branch_after):
                print(f"[orchestrator.commit_and_push] PR already exists for branch {branch_after!r}.")
            else:
                create_pr(branch_after, base_branch, wbs_id)

            maybe_merge_pr(auto_merge_pr)

    print("[orchestrator.commit_and_push] Done. git status (after):")
    git("status", "--short", check=False)


if __name__ == "__main__":
    main()
