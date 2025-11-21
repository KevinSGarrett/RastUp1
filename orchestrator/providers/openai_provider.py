from __future__ import annotations

import os
from typing import Optional, Any, Dict, List

from .base import LLMProvider

try:
    # New OpenAI SDK (>= 1.0)
    from openai import OpenAI as _OpenAI  # type: ignore
except Exception:  # pragma: no cover
    _OpenAI = None


class OpenAIProvider(LLMProvider):
    """
    Thin provider wrapper around OpenAI Chat Completions.

    Minimal contract used by the router/tests:
      - .name: provider identifier (string)
      - .call(prompt, *, system=None, model=None, **kwargs) -> str

    NOTE: Runs in *stub* mode by default to avoid network calls in CI.
          Set ORCHESTRATOR_LIVE_LLM=1 to enable live API calls.
    """

    # <<< minimal fix for tests >>>
    name: str = "openai"

    def __init__(self, default_model: Optional[str] = None) -> None:
        self.default_model: str = default_model or os.getenv(
            "ORCHESTRATOR_OPENAI_MODEL_DEFAULT", "gpt-5"
        )

    def _should_stub(self) -> bool:
        flag = os.getenv("ORCHESTRATOR_LIVE_LLM", "").strip().lower()
        return flag not in {"1", "true", "yes", "on"}

    def call(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        model: Optional[str] = None,
        **kwargs: Any,
    ) -> str:
        """
        Execute a chat completion (or return a stub echo).

        If live mode is disabled or the SDK isn't available, return a trimmed echo
        so downstream code proceeds without hard failures.
        """
        if self._should_stub() or _OpenAI is None:
            return (prompt or "").strip()

        try:
            client = _OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

            messages: List[Dict[str, str]] = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt or ""})

            # Only pass through common/allowed kwargs
            allowed_keys = {
                "temperature",
                "top_p",
                "presence_penalty",
                "frequency_penalty",
                "n",
                "stop",
                "logit_bias",
                "seed",
                "response_format",
                "tools",
                "tool_choice",
                "user",
            }
            allowed = {k: v for k, v in kwargs.items() if k in allowed_keys}

            resp = client.chat.completions.create(
                model=(model or self.default_model),
                messages=messages,
                **allowed,
            )

            text = ""
            if getattr(resp, "choices", None):
                choice0 = resp.choices[0]
                msg = getattr(choice0, "message", None)
                if msg is not None:
                    text = getattr(msg, "content", "") or ""
                else:
                    # Some responses may place text directly on the choice.
                    text = getattr(choice0, "text", "") or ""

            return (text or "").strip()

        except Exception:
            # Never explode in CI/offline modes—return stub echo.
            return (prompt or "").strip()
