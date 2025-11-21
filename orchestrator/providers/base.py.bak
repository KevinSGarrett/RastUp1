# orchestrator/providers/base.py
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

# Env toggle used by tests/CI to stub out provider calls
STUB_ENV = "ORCHESTRATOR_LLM_STUB"


@dataclass
class LLMResponse:
    model: str
    content: str
    role: str = "assistant"
    finish_reason: str = "stop"
    usage: Optional[Dict[str, int]] = None
    raw: Any = None


@runtime_checkable
class LLMProvider(Protocol):
    """
    Minimal protocol the orchestrator/tests expect.
    Concrete providers (OpenAIProvider, AnthropicProvider) should implement at
    least one of: `chat` (messages) or `complete` (single prompt).
    """
    model: str

    def chat(self, messages: List[Dict[str, str]], **kwargs: Any) -> LLMResponse: ...
    def complete(self, prompt: str, **kwargs: Any) -> LLMResponse: ...


def stub_enabled() -> bool:
    v = os.getenv(STUB_ENV, "0").lower()
    return v in ("1", "true", "yes", "on")


def _stub_reply(
    input_payload: Any,
    *,
    model: str = "stub",
    content: Optional[str] = None,
    role: str = "assistant",
    extra: Optional[Dict[str, Any]] = None,
) -> LLMResponse:
    """
    Produce a deterministic stub response when ORCHESTRATOR_LLM_STUB is set.
    Works for both text and messages inputs.
    """
    text = content or f"[stub:{os.getenv('ORCHESTRATOR_LLM_STUB_SEED', 'ok')}]"
    return LLMResponse(
        model=model,
        content=text,
        role=role,
        finish_reason="stop",
        usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        raw={"stub": True, "input": input_payload, **(extra or {})},
    )


__all__ = ["LLMResponse", "LLMProvider", "_stub_reply", "stub_enabled"]
