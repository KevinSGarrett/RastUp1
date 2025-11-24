DECISION_LOG_PATH = Path("docs/orchestrator/decision-log.md")

def ensure_decision_log_header():
    if not DECISION_LOG_PATH.exists():
        DECISION_LOG_PATH.write_text(
            "# Orchestrator Decision Log\n\n"
            "| Time (UTC) | WBS | Agent | CI Passed | Decision | Manager | Assistant | Reasons |\n"
            "|-----------|-----|-------|-----------|----------|---------|-----------|---------|\n",
            encoding="utf-8",
        )

def log_decision(entry: DecisionLogEntry):
    ensure_decision_log_header()
    row = (
        f"| {entry.timestamp_utc} | {entry.wbs_id} | {entry.agent_id} | "
        f"{'✅' if entry.ci_passed else '❌'} | {entry.decision} | "
        f"{entry.manager_model} | {entry.assistant_model} | "
        f"{'; '.join(entry.reasons)} |\n"
    )
    with DECISION_LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(row)
- 2025-11-24 17:36:16Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
