from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from openai import OpenAI


ROOT = Path(__file__).resolve().parent.parent
RUN_REPORTS_DIR = ROOT / "docs" / "runs"
ORCH_REVIEWS_DIR = ROOT / "docs" / "orchestrator" / "reviews"
MODEL_DECISIONS_PATH = ROOT / "ops" / "model-decisions.jsonl"


@dataclass
class RunReport:
    path: Path
    modified_at: float


def find_latest_run_report() -> Optional[RunReport]:
    if not RUN_REPORTS_DIR.exists():
        return None

    # Current structure uses flat files like 2025-11-18-WBS-021-AGENT-1.md
    candidates = [p for p in RUN_REPORTS_DIR.glob("*.md") if p.is_file()]
    if not candidates:
        return None

    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    return RunReport(path=latest, modified_at=latest.stat().st_mtime)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def parse_task_metadata(report_path: Path) -> Tuple[Optional[str], Optional[str]]:
    """
    Try to infer WBS task id and agent from filenames like:
      2025-11-18-WBS-021-AGENT-1.md
    """
    name = report_path.name
    m = re.search(r"(WBS-\d+).*?(AGENT-\d+)", name)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def choose_model_for_run_review(report_text: str) -> Tuple[str, str]:
    """
    Pick a model tier automatically based on input size and content.

    You can override defaults via environment variables:

      ORCHESTRATOR_MODEL
        -> hard override (one model for everything)

      ORCHESTRATOR_MODEL_LOW
        -> light/cheap model (default: gpt-4.1-mini)

      ORCHESTRATOR_MODEL_MEDIUM
        -> balanced model   (default: gpt-4.1)

      ORCHESTRATOR_MODEL_HIGH
        -> heavy model      (default: gpt-4.1)
    """
    # Hard override wins.
    forced = os.getenv("ORCHESTRATOR_MODEL")
    if forced:
        return forced, "forced via ORCHESTRATOR_MODEL env var"

    low_model = os.getenv("ORCHESTRATOR_MODEL_LOW", "gpt-4.1-mini")
    mid_model = os.getenv("ORCHESTRATOR_MODEL_MEDIUM", "gpt-4.1")
    high_model = os.getenv("ORCHESTRATOR_MODEL_HIGH", "gpt-4.1")

    text = report_text or ""
    length = len(text)

    # Base tier purely on size.
    if length < 6000:
        tier = "low"
        base_reason = f"length={length} < 6000 -> low tier"
    elif length < 20000:
        tier = "medium"
        base_reason = f"length={length} < 20000 -> medium tier"
    else:
        tier = "high"
        base_reason = f"length={length} >= 20000 -> high tier"

    # If content is clearly complex/sensitive, bump to at least medium/high.
    lower = text.lower()
    high_keywords = (
        "security",
        "compliance",
        "iam",
        "kms",
        "encryption",
        "schema",
        "migration",
        "experiment",
        "ab test",
        "analytics",
        "architecture",
        "performance",
        "privacy",
    )
    if any(k in lower for k in high_keywords):
        if tier == "low":
            tier = "medium"
            base_reason += " + bumped to medium for security/analytics/arch keywords"
        elif tier == "medium":
            tier = "high"
            base_reason += " + bumped to high for security/analytics/arch keywords"

    model_by_tier = {
        "low": low_model,
        "medium": mid_model,
        "high": high_model,
    }
    return model_by_tier[tier], base_reason


def record_model_decision(
    run: RunReport, model: str, reason: str, task_kind: str = "run_review"
) -> None:
    """
    Append a JSONL entry to ops/model-decisions.jsonl so we have a trace of
    which model the Orchestrator used, for which run, and why.
    """
    ensure_dir(MODEL_DECISIONS_PATH.parent)
    task_id, agent = parse_task_metadata(run.path)
    now = datetime.now(timezone.utc).isoformat()

    entry = {
        "timestamp": now,
        "actor": "ORCHESTRATOR",
        "task_kind": task_kind,
        "run_report": str(run.path.relative_to(ROOT)),
        "model": model,
        "reason": reason,
    }
    if task_id:
        entry["task_id"] = task_id
    if agent:
        entry["agent"] = agent

    with MODEL_DECISIONS_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def call_openai(model: str, system_prompt: str, user_content: str) -> str:
    """
    Call OpenAI using the OPENAI_API_KEY already exported in your shell.
    """
    client = OpenAI()

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_content,
            },
        ],
        temperature=0.1,
    )

    return response.choices[0].message.content or ""


def build_system_prompt() -> str:
    return (
        "You are the Orchestrator for a large multi-agent software project. "
        "Given an AGENT run report, you must:\n"
        "1) Summarize what was accomplished and what remains.\n"
        "2) Assess quality, risks, and missing automation/tests.\n"
        "3) Recommend follow-up tasks and whether the WBS item should "
        "stay in progress or can be marked done.\n"
        "4) Write in Markdown, with clear headings and bullet points.\n"
        "5) Be strict: do NOT mark work complete if automation, CI, or tests "
        "are missing, even if docs look good.\n"
    )


def main() -> None:
    ensure_dir(ORCH_REVIEWS_DIR)

    run = find_latest_run_report()
    if run is None:
        print("[orchestrator.review_latest] No run reports found under docs/runs/")
        return

    print(f"[orchestrator.review_latest] Found latest run report: {run.path}")

    report_text = read_text(run.path)

    # Dynamic model selection based on content/size.
    model, reason = choose_model_for_run_review(report_text)
    print(f"[orchestrator.review_latest] Using model: {model} ({reason})")

    system_prompt = build_system_prompt()
    print("[orchestrator.review_latest] Calling OpenAI for review...")
    review_md = call_openai(
        model=model,
        system_prompt=system_prompt,
        user_content=report_text,
    )

    # Persist orchestrator review.
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
    out_path = ORCH_REVIEWS_DIR / f"orchestrator-review-{ts}.md"
    header = (
        f"> Orchestrator review generated at {ts} UTC\n"
        f"> Reviewed run report: `{run.path.relative_to(ROOT)}`\n"
        f"> Model: {model} ({reason})\n\n"
    )
    out_path.write_text(header + review_md, encoding="utf-8")

    # Log the model decision for traceability.
    record_model_decision(run, model=model, reason=reason)

    print(f"[orchestrator.review_latest] Wrote orchestrator review to: {out_path}")


if __name__ == "__main__":
    main()
