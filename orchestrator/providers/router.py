import os

def pick_model(task_kind: str) -> str:
    if task_kind in {"review_latest", "apply_latest_review", "planning"}:
        return os.getenv("ORCH_MANAGER_LLM", "anthropic:claude-3-opus")
    if task_kind in {"codegen", "cursor_agent"}:
        return os.getenv("ORCH_CODER_LLM", "openai:gpt-5-codex")
    return os.getenv("ORCH_PRIMARY_LLM", "openai:gpt-5")
