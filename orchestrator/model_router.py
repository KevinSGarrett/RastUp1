from __future__ import annotations
import os
from typing import Dict, List, Tuple
from .providers import OpenAIProvider, AnthropicProvider, LLMProvider

# High-level policy: which providers/models per task "kind"
# - "review": Anthropic as assistant‑manager, OpenAI as primary decider
# - "sweep": OpenAI-only (fast/cheap)
# - default: OpenAI-only fallback

DEFAULT_OPENAI_REVIEW_MODEL = os.getenv(
    "ORCHESTRATOR_OPENAI_REVIEW_MODEL", "gpt-5"
)

# Default Anthropic review model; we use a model we know works for you as the
# assistant‑manager. Override via ORCHESTRATOR_ANTHROPIC_REVIEW_MODEL if needed.
DEFAULT_ANTHROPIC_REVIEW_MODEL = os.getenv(
    "ORCHESTRATOR_ANTHROPIC_REVIEW_MODEL", "claude-3-5-haiku-20241022"
)

POLICY: Dict[str, List[Tuple[str, str]]] = {
    "review": [
        # 0: Assistant‑manager reviewer
        ("anthropic", DEFAULT_ANTHROPIC_REVIEW_MODEL),
        # 1: Primary decider (manager)
        ("openai", DEFAULT_OPENAI_REVIEW_MODEL),
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
