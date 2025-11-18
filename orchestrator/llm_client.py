# orchestrator/llm_client.py
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

from openai import OpenAI  # pip install openai
import anthropic          # pip install anthropic


@dataclass
class LLMConfig:
    openai_model: str = "gpt-4.1-mini"          # you can change in ops/config.yaml
    embedding_model: str = "text-embedding-3-large"
    anthropic_model: Optional[str] = None       # e.g. "claude-3-5-sonnet-latest"
    temperature: float = 0.2


class LLMClient:
    """
    Thin wrapper over OpenAI + Anthropic.

    - OpenAI: main engine for indexing, planning, task prompts.
    - Anthropic: optional, good for long synth + heavy docs.
    """

    def __init__(self, cfg: LLMConfig):
        self.cfg = cfg
        self._openai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        anth_key = os.getenv("ANTHROPIC_API_KEY")
        self._anthropic = anthropic.Anthropic(api_key=anth_key) if anth_key else None

    # ---------- Embeddings (OpenAI) ----------

    def embed(self, texts: List[str], model: Optional[str] = None) -> List[List[float]]:
        model = model or self.cfg.embedding_model
        resp = self._openai.embeddings.create(
            model=model,
            input=texts,
        )
        return [item.embedding for item in resp.data]

    # ---------- Chat (OpenAI) ----------

    def chat_openai(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        **extra: Any,
    ) -> str:
        """
        Simple chat completion that returns message.content.

        We don't use tools/function-calling here; all "tools" are Python
        code in the orchestrator.
        """
        model = model or self.cfg.openai_model

        resp = self._openai.chat.completions.create(
            model=model,
            messages=messages,
            temperature=extra.get("temperature", self.cfg.temperature),
        )
        return resp.choices[0].message.content or ""

    # ---------- Chat (Anthropic, optional) ----------

    def chat_anthropic(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        **extra: Any,
    ) -> str:
        """
        Use Claude for heavy aggregation / long summarisation.

        messages: list of {"role": "system"|"user"|"assistant", "content": "..."}
        """
        if not self._anthropic:
            raise RuntimeError("ANTHROPIC_API_KEY not set but chat_anthropic() was called.")

        model = model or self.cfg.anthropic_model
        if not model:
            raise RuntimeError("No anthropic_model configured in LLMConfig.")

        # Anthropic messages API expects system + messages. :contentReference[oaicite:5]{index=5}
        system_msg = ""
        converted: List[Dict[str, Any]] = []
        for m in messages:
            if m["role"] == "system":
                system_msg += m["content"] + "\n"
            else:
                converted.append({"role": m["role"], "content": m["content"]})

        resp = self._anthropic.messages.create(
            model=model,
            max_tokens=extra.get("max_tokens", 2048),
            temperature=extra.get("temperature", self.cfg.temperature),
            system=system_msg or None,
            messages=converted,
        )

        # Join all text blocks together
        out_chunks: List[str] = []
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                out_chunks.append(block.text)
        return "\n".join(out_chunks)
