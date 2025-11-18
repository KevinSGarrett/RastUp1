# orchestrator/task_status.py
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

# Repo root is the project folder (e.g., C:\RastUp1)
REPO_ROOT = Path(__file__).resolve().parent.parent


def load_queue() -> List[Dict[str, Any]]:
    queue_path = REPO_ROOT / "ops" / "queue.jsonl"
    if not queue_path.exists():
        raise SystemExit(f"Queue file not found: {queue_path}. Run `python -m orchestrator.cli plan` first.")
    lines = [l for l in queue_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    return [json.loads(l) for l in lines]


def save_queue(items: List[Dict[str, Any]]) -> None:
    queue_path = REPO_ROOT / "ops" / "queue.jsonl"
    with queue_path.open("w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")


def cmd_list(args: argparse.Namespace) -> None:
    items = load_queue()

    # Simple, readable output grouped by status
    by_status: Dict[str, List[Dict[str, Any]]] = {}
    for it in items:
        by_status.setdefault(it["status"], []).append(it)

    for status, group in sorted(by_status.items()):
        print(f"\nStatus: {status}")
        for it in sorted(group, key=lambda x: x.get("priority", 9999)):
            tid = it["task_id"]
            agent = it["agent"]
            title = it.get("title", "") or "(no title)"
            deps = ", ".join(it.get("depends_on", [])) or "(none)"
            print(f"  - {tid} [{agent}] deps: {deps}  —  {title}")


def cmd_set(args: argparse.Namespace) -> None:
    task_id = args.id
    new_status = args.status

    if new_status not in {"todo", "in_progress", "done", "review", "partial"}:
        raise SystemExit("Status must be one of: todo, in_progress, done, review, partial")

    items = load_queue()
    found = False

    for it in items:
        if it["task_id"] == task_id:
            old = it["status"]
            it["status"] = new_status
            found = True
            print(f"Updated {task_id}: {old} -> {new_status}")

    if not found:
        print(f"No item with task_id {task_id} found in queue.")
    else:
        save_queue(items)


def main() -> None:
    parser = argparse.ArgumentParser(description="Orchestrator task status helper")
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="List tasks and their statuses.")
    p_list.set_defaults(func=cmd_list)

    p_set = sub.add_parser("set", help="Set the status of a specific task.")
    p_set.add_argument("--id", required=True, help="Task ID, e.g., WBS-001")
    p_set.add_argument(
        "--status",
        required=True,
        help="New status: todo, in_progress, done, review, partial",
    )
    p_set.set_defaults(func=cmd_set)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
