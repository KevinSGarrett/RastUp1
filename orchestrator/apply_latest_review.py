from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


ROOT = Path(__file__).resolve().parent.parent
REVIEWS_DIR = ROOT / "docs" / "orchestrator" / "reviews"


@dataclass
class ReviewFile:
    path: Path
    modified_at: float


def find_latest_review() -> Optional[ReviewFile]:
    if not REVIEWS_DIR.exists():
        print("[apply_latest_review] No reviews directory found; nothing to do.")
        return None

    candidates = [
        p for p in REVIEWS_DIR.glob("orchestrator-review-*.md")
        if p.is_file()
    ]
    if not candidates:
        print("[apply_latest_review] No review files found; nothing to do.")
        return None

    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    return ReviewFile(path=latest, modified_at=latest.stat().st_mtime)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def decide_status(review_text: str, task_id: str) -> str:
    """
    Very simple rule:
    - If the review explicitly says "Do NOT mark ... as complete"
      or "remains IN PROGRESS" → keep it in_progress.
    - Otherwise → assume done.
    """
    lowered = review_text.lower()
    task_lower = task_id.lower()

    if f"do not mark {task_lower} as complete" in lowered:
        return "in_progress"

    if "remains in progress" in lowered and task_lower in lowered:
        return "in_progress"

    if "blocked" in lowered and task_lower in lowered:
        # Conservative: if it says the task is blocked, don't mark done.
        return "in_progress"

    # Default: treat as done
    return "done"


def set_task_status(task_id: str, status: str) -> None:
    print(f"[apply_latest_review] Setting {task_id} -> {status}")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "orchestrator.task_status",
            "set",
            "--id",
            task_id,
            "--status",
            status,
        ],
        cwd=ROOT,
        text=True,
        check=True,
    )


def main() -> None:
    review = find_latest_review()
    if review is None:
        return

    text = read_text(review.path)
    # Grab the first WBS-XXX we see
    match = re.search(r"WBS-\d+", text)
    if not match:
        print(f"[apply_latest_review] Could not find WBS id in {review.path}; skipping.")
        return

    task_id = match.group(0)
    status = decide_status(text, task_id)
    set_task_status(task_id, status)


if __name__ == "__main__":
    main()
