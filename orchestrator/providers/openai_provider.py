from __future__ import annotations
import os
from typing import Optional
from .base import LLMProvider

try:
    # Newer OpenAI SDK
    from openai import OpenAI as _OpenAI
except Exception:  # pragma: no cover
    _OpenAI = None  # SDK not installed; we'll stub

class OpenAIProvider(LLMProvider):
    def __init__(self, default_model: Optional[str] = None):
        super().__init__(
            name="openai",
            default_model=default_model or os.getenv("ORCHESTRATOR_OPENAI_MODEL_DEFAULT", "gpt-5"),
        )

    def _is_available(self) -> bool:
        return _OpenAI is not None and bool(os.getenv("OPENAI_API_KEY"))

    def _complete_impl(self, *, prompt: str, model: Optional[str], system: Optional[str], **kwargs) -> str:
        client = _OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        # Use Chat Completions for broad compatibility
        resp = client.chat.completions.create(
            model=model or self.default_model,
            messages=messages,
            temperature=kwargs.get("temperature", 0),
            max_tokens=kwargs.get("max_tokens", 1024),
        )
        return (resp.choices[0].message.content or "").strip()
