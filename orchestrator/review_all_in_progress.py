from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from openai import OpenAI


ROOT = Path(__file__).resolve().parent.parent
RUN_REPORTS_DIR = ROOT / "docs" / "runs"
MODEL_DECISIONS_PATH = ROOT / "ops" / "model-decisions.jsonl"


@dataclass
class RunReport:
    path: Path
    modified_at: float
    wbs_id: str


def _run(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        capture_output=True,
    )


def get_wbs_by_status() -> Dict[str, List[str]]:
    proc = _run([sys.executable, "-m", "orchestrator.task_status", "list"])
    if proc.returncode != 0:
        raise RuntimeError(f"task_status list failed: {proc.stderr}")

    status_map: Dict[str, List[str]] = {}
    current_status: Optional[str] = None

    for raw in proc.stdout.splitlines():
        line = raw.strip()
        if line.startswith("Status:"):
            parts = line.split()
            if len(parts) >= 2:
                current_status = parts[1]
                status_map.setdefault(current_status, [])
        else:
            m = re.search(r"(WBS-\d+)", line)
            if current_status and m:
                status_map.setdefault(current_status, []).append(m.group(1))

    return status_map


def find_run_report_for_wbs(wbs_id: str) -> Optional[RunReport]:
    if not RUN_REPORTS_DIR.exists():
        return None

    pattern = f"*{wbs_id}*.md"
    candidates = [p for p in RUN_REPORTS_DIR.glob(pattern) if p.is_file()]
    if not candidates:
        return None

    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    return RunReport(path=latest, modified_at=latest.stat().st_mtime, wbs_id=wbs_id)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def choose_model_for_task(wbs_id: str, report_text: str) -> str:
    low = os.getenv("ORCHESTRATOR_MODEL_LOW", "gpt-4.1-mini")
    medium = os.getenv("ORCHESTRATOR_MODEL_MEDIUM", "gpt-4.1")
    high = os.getenv("ORCHESTRATOR_MODEL_HIGH", "gpt-5")

    text = report_text.lower()
    length = len(report_text)

    if any(k in text for k in ("security", "privacy", "pci", "dsar", "iam", "kms")):
        tier = "high"
        model = high
    elif length > 12000 or any(k in text for k in ("analytics", "experimentation", "architecture")):
        tier = "medium"
        model = medium
    else:
        tier = "low"
        model = low

    print(f"[review_all_in_progress] Using model={model} (tier={tier}) for {wbs_id}")
    return model


def log_model_decision(payload: dict) -> None:
    MODEL_DECISIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MODEL_DECISIONS_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload) + "\n")


def call_openai_for_wbs(wbs_id: str, report_text: str) -> str:
    model = choose_model_for_task(wbs_id, report_text)
    client = OpenAI()

    system_prompt = (
        "You are the autopilot orchestrator for a large engineering project.\n"
        "You will be given a single WBS run report.\n\n"
        "Decide STRICTLY whether the WBS item is:\n"
        "- complete (can be marked DONE), or\n"
        "- still in progress (IN_PROGRESS) because critical work is missing.\n\n"
        "Rules:\n"
        "- Consider docs/tests/automation/CI/infrastructure, not just code.\n"
        "- If major automation, CI, or critical flows are missing, prefer IN_PROGRESS.\n"
        "- If the acceptance criteria described in the report appear satisfied and\n"
        "  remaining work is minor/nice-to-have, choose DONE.\n\n"
        "Output format:\n"
        "First line MUST be exactly one of:\n"
        "  STATUS: done\n"
        "  STATUS: in_progress\n"
        "Then a blank line, then a short explanation.\n"
    )

    print(f"[review_all_in_progress] Calling OpenAI for {wbs_id} ...")
    started_at = datetime.now(timezone.utc).isoformat()

    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": report_text},
        ],
    )

    content = resp.choices[0].message.content or ""
    finished_at = datetime.now(timezone.utc).isoformat()

    log_model_decision(
        {
            "kind": "wbs_status_decision",
            "wbs_id": wbs_id,
            "model": model,
            "started_at": started_at,
            "finished_at": finished_at,
            "raw_response": content[:4000],
        }
    )

    first_line = content.strip().splitlines()[0].strip().lower()
    if "status: done" in first_line:
        status = "done"
    else:
        status = "in_progress"

    print(f"[review_all_in_progress] Decision for {wbs_id}: {status} ({first_line})")
    return status


def set_wbs_status(wbs_id: str, status: str) -> None:
    print(f"[review_all_in_progress] Setting {wbs_id} -> {status}")
    proc = _run(
        [
            sys.executable,
            "-m",
            "orchestrator.task_status",
            "set",
            "--id",
            wbs_id,
            "--status",
            status,
        ]
    )
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)


def main() -> None:
    print("[review_all_in_progress] Sweeping all in-progress WBS items ...")
    status_map = get_wbs_by_status()
    in_progress_ids = status_map.get("in_progress", [])

    if not in_progress_ids:
        print("[review_all_in_progress] No in-progress items; nothing to do.")
        return

    for wbs_id in in_progress_ids:
        report = find_run_report_for_wbs(wbs_id)
        if report is None:
            print(
                f"[review_all_in_progress] No run report found for {wbs_id}; "
                "resetting status to todo so it can be re-run."
            )
            set_wbs_status(wbs_id, "todo")
            continue

        report_text = read_text(report.path)
        status = call_openai_for_wbs(wbs_id, report_text)
        set_wbs_status(wbs_id, status)

    print("[review_all_in_progress] Sweep complete.")


if __name__ == "__main__":
    main()
