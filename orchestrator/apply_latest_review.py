import os
import re
import sys
import subprocess
import datetime
from typing import Optional

# Where we log decisions so you can read what the manager decided later.
DECISION_LOG_PATH = os.path.join("docs", "orchestrator", "decision-log.md")

# WBS IDs like WBS-001
_WBS_RE = re.compile(r"WBS-\d{3}")

# Manager decision signals in the orchestrator review.
# We support multiple shapes so we don't depend on one exact wording.
_ACCEPT_YES_RE = re.compile(
    r"^(?:ACCEPTANCE:\s*(?:yes|met)\b|Decision:\s*(?:done|accept(?:ed)?)\b)",
    re.IGNORECASE | re.MULTILINE,
)
_ACCEPT_NO_RE = re.compile(
    r"^(?:ACCEPTANCE:\s*(?:no|unmet)\b|Decision:\s*(?:reject(?:ed)?|in[_\s-]?progress)\b)",
    re.IGNORECASE | re.MULTILINE,
)

# CI result in the *agent run report*:
# e.g.
#   6. make ci
#      Result: PASS — ...
_CI_RE = re.compile(
    r"make ci[^\n]*\n\s*Result:\s*(PASS|FAIL)",
    re.IGNORECASE,
)


def _find_wbs_id_from_text(text: str) -> Optional[str]:
    m = _WBS_RE.search(text)
    return m.group(0) if m else None


def _guess_wbs_id(review_path: str) -> Optional[str]:
    """
    Try to figure out which WBS this review belongs to.

    We first look in the filename (e.g. orchestrator-review-WBS-001-...md),
    and if that fails we fall back to looking inside the file contents.
    """
    # 1) Try to find WBS in the path string itself.
    wbs = _find_wbs_id_from_text(review_path)
    if wbs:
        return wbs

    # 2) Fall back to scanning the file contents.
    try:
        with open(review_path, "r", encoding="utf-8") as f:
            return _find_wbs_id_from_text(f.read())
    except FileNotFoundError:
        return None


def _find_run_report_for_wbs(wbs_id: str) -> Optional[str]:
    """
    Find the most recent docs/runs/* file that mentions this WBS id
    in the filename (e.g. 2025-11-24-WBS-001-AGENT-1.md).
    """
    runs_dir = os.path.join("docs", "runs")
    if not os.path.isdir(runs_dir):
        return None

    candidates = []
    for name in os.listdir(runs_dir):
        if not name.endswith(".md"):
            continue
        if wbs_id not in name:
            continue
        path = os.path.join(runs_dir, name)
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            mtime = 0.0
        candidates.append((mtime, path))

    if not candidates:
        return None

    candidates.sort()
    return candidates[-1][1]  # newest


def _ci_passed_from_run_report(text: str) -> Optional[bool]:
    """
    Look inside the agent run report and see what happened to `make ci`.

    Returns:
        True  -> run report explicitly shows `make ci` Result: PASS
        False -> run report explicitly shows `make ci` Result: FAIL
        None  -> no `make ci` entry found
    """
    m = _CI_RE.search(text)
    if not m:
        return None
    return m.group(1).upper() == "PASS"


def _passes_ci_rerun() -> bool:
    """
    Fallback: actually run `make ci` again if the run report
    doesn’t contain a `make ci` entry.
    """
    return subprocess.run(["make", "ci"], check=False).returncode == 0


def _acceptance_is_yes(review_text: str) -> bool:
    """
    Parse the manager’s decision from the orchestrator review.

    We support a few shapes so the manager can say either:

      - ACCEPTANCE: yes / no
      - ACCEPTANCE: met / unmet
      - Decision: done / in_progress
      - Decision: accept / accepted / reject / rejected

    Rules:

      - If we see any explicit *negative* signal (reject / in_progress / no / unmet),
        we treat it as not accepted.
      - Otherwise, if we see a positive signal (done / accept / accepted / yes / met),
        we treat it as accepted.
      - If we see neither, we default to "not accepted" for safety.
    """
    if _ACCEPT_NO_RE.search(review_text):
        return False
    return bool(_ACCEPT_YES_RE.search(review_text))


def _append_decision_log(
    *,
    wbs_id: Optional[str],
    review_path: str,
    run_report_path: Optional[str],
    acceptance_yes: bool,
    ci_status: str,
    allowed: bool,
) -> None:
    """
    Append a one-line decision entry to docs/orchestrator/decision-log.md
    so you can see exactly why something was allowed/blocked.
    """
    os.makedirs(os.path.dirname(DECISION_LOG_PATH), exist_ok=True)

    # Use timezone-aware UTC to avoid DeprecationWarning.
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    ts = now_utc.strftime("%Y-%m-%d %H:%M:%SZ")

    line = (
        f"- {ts} "
        f"WBS={wbs_id or '?'} "
        f"acceptance={'yes' if acceptance_yes else 'no'} "
        f"ci={ci_status} "
        f"gate_apply={'ALLOW' if allowed else 'BLOCK'} "
        f"review={review_path}"
    )
    if run_report_path:
        line += f" run_report={run_report_path}"
    line += "\n"

    if not os.path.exists(DECISION_LOG_PATH):
        # First time: add a small header.
        with open(DECISION_LOG_PATH, "w", encoding="utf-8") as f:
            f.write("# Orchestrator decision log\n\n")
            f.write(line)
    else:
        with open(DECISION_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line)


def gate_apply(review_path: str) -> bool:
    """
    Decide whether it is safe for the orchestrator to apply the latest review
    and mark the associated WBS task as DONE.

    Rules:

    - Must be able to associate the review with a WBS id.
    - Must find a run report for that WBS (if possible).
    - The review's acceptance signal must be positive.
    - We **never** allow DONE if CI is red:

        * If run report shows `make ci` Result: FAIL -> block.
        * If run report shows `make ci` Result: PASS -> OK (subject to acceptance).
        * If run report has no `make ci` entry -> re‑run `make ci`
          locally and require it to pass.
    """
    # 1) Figure out which WBS we’re talking about.
    wbs_id = _guess_wbs_id(review_path)

    run_report_path: Optional[str] = None
    run_report_text: Optional[str] = None
    ci_from_report: Optional[bool] = None

    # 2) Find and parse the matching run report (if any).
    if wbs_id is not None:
        run_report_path = _find_run_report_for_wbs(wbs_id)
        if run_report_path and os.path.exists(run_report_path):
            try:
                with open(run_report_path, "r", encoding="utf-8") as f:
                    run_report_text = f.read()
            except FileNotFoundError:
                run_report_text = None

    if run_report_text is not None:
        ci_from_report = _ci_passed_from_run_report(run_report_text)

    # 3) If CI is explicitly red in the run report, block early.
    if ci_from_report is False:
        _append_decision_log(
            wbs_id=wbs_id,
            review_path=review_path,
            run_report_path=run_report_path,
            acceptance_yes=False,  # irrelevant, CI already failed
            ci_status="FAIL",
            allowed=False,
        )
        return False

    # 4) Load the manager’s review and parse acceptance.
    try:
        with open(review_path, "r", encoding="utf-8") as f:
            review_text = f.read()
    except FileNotFoundError:
        _append_decision_log(
            wbs_id=wbs_id,
            review_path=review_path,
            run_report_path=run_report_path,
            acceptance_yes=False,
            ci_status="NO_REVIEW",
            allowed=False,
        )
        return False

    acceptance_yes = _acceptance_is_yes(review_text)

    # 5) If the manager did not explicitly accept, block.
    if not acceptance_yes:
        ci_status = (
            "PASS"
            if ci_from_report is True
            else "UNKNOWN"
            if ci_from_report is None
            else "FAIL"
        )
        _append_decision_log(
            wbs_id=wbs_id,
            review_path=review_path,
            run_report_path=run_report_path,
            acceptance_yes=acceptance_yes,
            ci_status=ci_status,
            allowed=False,
        )
        return False

    # 6) Manager accepted; now enforce the CI rule.
    if ci_from_report is True:
        # CI already known good from the run report.
        ci_status = "PASS"
        allowed = True
    else:
        # No explicit `make ci` entry; re‑run CI locally.
        rerun_ok = _passes_ci_rerun()
        ci_status = "PASS_RERUN" if rerun_ok else "FAIL_RERUN"
        allowed = rerun_ok

    _append_decision_log(
        wbs_id=wbs_id,
        review_path=review_path,
        run_report_path=run_report_path,
        acceptance_yes=acceptance_yes,
        ci_status=ci_status,
        allowed=allowed,
    )
    return allowed


def _latest_review_path(root: str = ".") -> Optional[str]:
    """
    Find the latest orchestrator review file.

    Preference order:
      1) docs/orchestrator/reviews/latest.md (alias written by review_latest)
      2) newest docs/orchestrator/reviews/orchestrator-review-*.md
    """
    reviews_dir = os.path.join(root, "docs", "orchestrator", "reviews")
    alias = os.path.join(reviews_dir, "latest.md")
    if os.path.exists(alias):
        return alias

    if not os.path.isdir(reviews_dir):
        return None

    candidates = []
    for name in os.listdir(reviews_dir):
        if not name.endswith(".md"):
            continue
        if not name.startswith("orchestrator-review-"):
            continue
        path = os.path.join(reviews_dir, name)
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            mtime = 0.0
        candidates.append((mtime, path))

    if not candidates:
        return None

    candidates.sort()
    return candidates[-1][1]


def main(argv: Optional[list[str]] = None) -> None:
    """
    CLI entrypoint used by:

        python -m orchestrator.apply_latest_review
        python -m orchestrator.apply_latest_review .

    Behavior:

      - Locate the latest orchestrator review.
      - Decide (via gate_apply) if it's safe to mark the WBS as DONE.
      - If allowed -> set WBS status to `done`.
      - If blocked -> set WBS status to `in_progress`.
    """
    if argv is None:
        argv = sys.argv[1:]

    # If the first arg is a directory (e.g. "." from autopilot), treat it as repo root.
    root = argv[0] if (argv and os.path.isdir(argv[0])) else "."

    review_path = _latest_review_path(root)
    if not review_path:
        print("[apply_latest_review] No review file found; nothing to do.")
        return

    # Decide whether it's safe to mark DONE.
    allowed = gate_apply(review_path)

    # Figure out the WBS id from the review path / contents.
    wbs_id = _guess_wbs_id(review_path)
    if not wbs_id:
        print(
            f"[apply_latest_review] Could not determine WBS id from "
            f"{review_path}; skipping."
        )
        return

    status = "done" if allowed else "in_progress"
    print(f"[apply_latest_review] Setting {wbs_id} -> {status}")

    # Update status via the existing orchestrator.task_status CLI.
    cmd = [
        sys.executable,
        "-m",
        "orchestrator.task_status",
        "set",
        "--id",
        wbs_id,
        "--status",
        status,
    ]
    subprocess.run(cmd, check=False)


if __name__ == "__main__":
    main()
