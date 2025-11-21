from __future__ import annotations

import os
from typing import Optional, Any, List

from .base import LLMProvider


class AnthropicProvider(LLMProvider):
    """
    Thin provider wrapper around Anthropic Messages API.

    Minimal contract used by the router/tests:
      - .name: provider identifier (string)
      - .call(prompt, *, system=None, model=None, **kwargs) -> str

    NOTE: Runs in *stub* mode by default to avoid network calls in CI.
          Set ORCHESTRATOR_LIVE_LLM=1 to enable live API calls.
    """

    # <<< minimal fix for tests >>>
    name: str = "anthropic"

    def __init__(self, default_model: Optional[str] = None) -> None:
        self.default_model: str = default_model or os.getenv(
            "ORCHESTRATOR_ANTHROPIC_MODEL_DEFAULT", "claude-3-opus"
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
        Execute an Anthropic messages call (or return a stub echo).

        If live mode is disabled or the SDK isn't available, return a trimmed echo
        so downstream code proceeds without hard failures.
        """
        if self._should_stub():
            return (prompt or "").strip()

        try:
            # Lazy import so environments without the SDK still work
            from anthropic import Anthropic  # type: ignore
        except Exception:  # pragma: no cover
            return (prompt or "").strip()

        try:
            client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

            # Anthropic requires max_tokens; allow override via kwargs or env.
            max_tokens = int(
                kwargs.pop("max_tokens", os.getenv("ORCHESTRATOR_ANTHROPIC_MAX_TOKENS", "1024"))
            )

            resp = client.messages.create(
                model=(model or self.default_model),
                system=system,
                messages=[{"role": "user", "content": prompt or ""}],
                max_tokens=max_tokens,
                **kwargs,
            )

            # Extract string from returned content blocks (TextBlock or dicts).
            content = getattr(resp, "content", []) or []
            parts: List[str] = []
            for block in content:
                if hasattr(block, "text"):
                    parts.append(getattr(block, "text") or "")
                elif isinstance(block, dict) and "text" in block:
                    parts.append(block.get("text") or "")
            text = "".join(parts)

            return (text or "").strip()

        except Exception:
            # Never explode in CI/offline modes—return stub echo.
            return (prompt or "").strip()
