from __future__ import annotations
import os
from typing import Dict, List, Tuple
from .providers import OpenAIProvider, AnthropicProvider, LLMProvider

# High-level policy: which providers/models per task "kind"
# - "review": use BOTH providers → Anthropic as assistant-manager/secondary reviewer; OpenAI as primary/decider
# - "sweep": OpenAI-only (fast/cheap)
# - default: OpenAI-only fallback
POLICY: Dict[str, List[Tuple[str, str]]] = {
    "review": [
        ("openai", os.getenv("ORCHESTRATOR_OPENAI_REVIEW_MODEL", "gpt-5")),
        ("anthropic", os.getenv("ORCHESTRATOR_ANTHROPIC_REVIEW_MODEL", "claude-3-5-sonnet")),
    ],
    "sweep": [
        ("openai", os.getenv("ORCHESTRATOR_OPENAI_SWEEP_MODEL", "gpt-4.1-mini")),
    ],
}

class ModelRouter:
    def __init__(self):
        self.providers: Dict[str, LLMProvider] = {
            "openai": OpenAIProvider(),
            "anthropic": AnthropicProvider(),
        }

    def plan_for_kind(self, kind: str) -> List[Dict[str, str]]:
        plan = POLICY.get(kind)
        if not plan:
            plan = [("openai", os.getenv("ORCHESTRATOR_OPENAI_MODEL_DEFAULT", "gpt-4.1-mini"))]
        entries: List[Dict[str, str]] = []
        for provider_name, model in plan:
            entries.append(
                {
                    "provider": provider_name,
                    "model": model,
                    # Very rough tier guess for printing/logs
                    "tier": "high" if ("gpt-5" in model or "sonnet" in model or "opus" in model) else "low",
                }
            )
        return entries

    def providers_for_kind(self, kind: str):
        """
        Returns a list of (provider_instance, model) tuples in policy order.
        """
        plan = self.plan_for_kind(kind)
        result = []
        for entry in plan:
            result.append((self.providers[entry["provider"]], entry["model"]))
        return result
