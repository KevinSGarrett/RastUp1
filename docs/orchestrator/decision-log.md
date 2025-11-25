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
- 2025-11-24 18:13:19Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 18:14:25Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 18:15:46Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 18:17:12Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 18:18:47Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 18:20:25Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 18:21:42Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 19:24:22Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 19:27:03Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 19:28:40Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 19:31:47Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 19:33:38Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 19:35:28Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 19:50:41Z WBS=WBS-001 acceptance=no ci=FAIL gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1.md
- 2025-11-24 20:22:14Z WBS=WBS-001 acceptance=no ci=PASS gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1-Part2.md
- 2025-11-25 02:29:25Z WBS=WBS-001 acceptance=no ci=PASS gate_apply=BLOCK review=./docs/orchestrator/reviews/latest.md run_report=docs/runs/2025-11-24-WBS-001-AGENT-1-Part2.md
