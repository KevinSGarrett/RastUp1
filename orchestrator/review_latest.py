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
    wbs_id: Optional[str]


def find_latest_run_report() -> Optional[RunReport]:
    if not RUN_REPORTS_DIR.exists():
        return None

    candidates = [p for p in RUN_REPORTS_DIR.glob("*.md") if p.is_file()]
    if not candidates:
        return None

    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    m = re.search(r"(WBS-\d+)", latest.name)
    wbs_id = m.group(1) if m else None

    return RunReport(
        path=latest,
        modified_at=latest.stat().st_mtime,
        wbs_id=wbs_id,
    )


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def select_model_for_review(text: str) -> Tuple[str, str]:
    """
    Choose a model tier based on length + risk.

    Uses env vars:
      ORCHESTRATOR_MODEL_LOW     (default: gpt-4.1-mini)
      ORCHESTRATOR_MODEL_MEDIUM  (default: gpt-4.1)
      ORCHESTRATOR_MODEL_HIGH    (default: gpt-5.1)
    """
    low = os.getenv("ORCHESTRATOR_MODEL_LOW", "gpt-4.1-mini")
    medium = os.getenv("ORCHESTRATOR_MODEL_MEDIUM", "gpt-4.1")
    high = os.getenv("ORCHESTRATOR_MODEL_HIGH", "gpt-5.1")

    length = len(text)
    lc = text.lower()

    high_keywords = (
        "security",
        "privacy",
        "pci",
        "encryption",
        "iam",
        "audit",
        "payment",
        "stripe",
        "dsar",
    )

    if any(k in lc for k in high_keywords) or length > 12000:
        return high, "high"
    elif length > 4000:
        return medium, "medium"
    else:
        return low, "low"


def call_openai(model: str, system_prompt: str, user_content: str) -> str:
    """
    Call OpenAI to generate an orchestrator review.

    For GPT-5 / o3 / o4-mini we omit temperature to avoid the 400 error.
    """
    client = OpenAI()

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    kwargs = {
        "model": model,
        "messages": messages,
    }

    # Reasoning models don't support non-default temperature
    if not (
        model.startswith("gpt-5")
        or model.startswith("o3")
        or model.startswith("o4-mini")
    ):
        kwargs["temperature"] = 0.1

    resp = client.chat.completions.create(**kwargs)
    return (resp.choices[0].message.content or "").strip()


def log_model_decision(entry: dict) -> None:
    MODEL_DECISIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    entry_with_ts = {
        **entry,
        "logged_at": datetime.now(timezone.utc).isoformat(),
    }
    with MODEL_DECISIONS_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry_with_ts) + "\n")


def build_system_prompt(wbs_id: Optional[str]) -> str:
    wbs_hint = wbs_id or "UNKNOWN"
    return f"""
You are the Orchestrator for a large engineering program.

You will receive a single WBS run report and must:

1. Summarize what was accomplished vs. what remains.
2. Assess quality, risks, and missing automation/tests.
3. Decide whether it's reasonable to treat this WBS as "complete for this phase"
   or if it must remain in-progress.

STRICT OUTPUT REQUIREMENT:

- If you believe the work is NOT complete, you MUST include the exact sentence:
  "Do NOT mark {wbs_hint} as complete."

- If you believe the work IS complete enough to mark done for this phase, you MUST include:
  "It is reasonable to mark {wbs_hint} as complete."

Your tone should be concise and operator-friendly.
""".strip()


def build_user_content(run_report: RunReport, text: str) -> str:
    return f"""Run report path: {run_report.path}
WBS id (from filename): {run_report.wbs_id or "UNKNOWN"}

=== RUN REPORT BEGIN ===
{text}
=== RUN REPORT END ===
"""


def write_review_md(run_report: RunReport, review_md: str, model: str, tier: str) -> Path:
    ensure_dir(ORCH_REVIEWS_DIR)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
    wbs_part = run_report.wbs_id or "UNKNOWN"
    out_path = ORCH_REVIEWS_DIR / f"orchestrator-review-{wbs_part}-{ts}.md"

    header = [
        f"> Orchestrator review generated at {ts} UTC",
        f"> Reviewed run report: `{run_report.path.relative_to(ROOT)}`",
        f"> WBS: {wbs_part}",
        f"> Model: {model} (tier={tier})",
        "",
    ]

    out_path.write_text("\n".join(header) + "\n" + review_md + "\n", encoding="utf-8")
    return out_path


def main() -> None:
    run_report = find_latest_run_report()
    if not run_report:
        print("[orchestrator.review_latest] No run reports found; nothing to do.")
        return

    text = read_text(run_report.path)
    model, tier = select_model_for_review(text)

    print(
        f"[orchestrator.review_latest] Found latest run report: {run_report.path}"
    )
    print(
        f"[orchestrator.review_latest] Using model: {model} "
        f"(tier={tier}, length={len(text)})"
    )
    print("[orchestrator.review_latest] Calling OpenAI for review...")

    system_prompt = build_system_prompt(run_report.wbs_id)
    user_content = build_user_content(run_report, text)
    review_md = call_openai(model, system_prompt, user_content)

    out_path = write_review_md(run_report, review_md, model, tier)
    print(f"[orchestrator.review_latest] Wrote orchestrator review to: {out_path}")

    log_model_decision(
        {
            "source": "review_latest",
            "model": model,
            "tier": tier,
            "wbs_id": run_report.wbs_id,
            "run_report_path": str(run_report.path),
            "review_path": str(out_path),
        }
    )


if __name__ == "__main__":
    main()
