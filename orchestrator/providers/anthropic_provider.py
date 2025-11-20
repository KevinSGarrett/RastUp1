from __future__ import annotations
import os
from typing import Optional
from .base import LLMProvider

try:
    import anthropic as _anthropic  # Claude SDK
except Exception:  # pragma: no cover
    _anthropic = None

class AnthropicProvider(LLMProvider):
    def __init__(self, default_model: Optional[str] = None):
        super().__init__(
            name="anthropic",
            default_model=default_model or os.getenv("ORCHESTRATOR_ANTHROPIC_MODEL_DEFAULT", "claude-3-5-sonnet"),
        )

    def _is_available(self) -> bool:
        return _anthropic is not None and bool(os.getenv("ANTHROPIC_API_KEY"))

    def _complete_impl(self, *, prompt: str, model: Optional[str], system: Optional[str], **kwargs) -> str:
        client = _anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        # Anthropic's Messages API
        params = {
            "model": model or self.default_model,
            "max_tokens": kwargs.get("max_tokens", 1024),
            "temperature": kwargs.get("temperature", 0),
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            params["system"] = system

        resp = client.messages.create(**params)

        # Concatenate text blocks (Anthropic returns a list of blocks)
        text_parts = []
        try:
            for block in getattr(resp, "content", []) or []:
                value = getattr(block, "text", None)
                if value:
                    text_parts.append(value)
        except Exception:
            pass

        return ("\n".join(text_parts) if text_parts else str(resp)).strip()
