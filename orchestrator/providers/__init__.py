# orchestrator/providers/__init__.py
from __future__ import annotations

"""
Provider registry & helpers.

- Optional provider imports (OpenAI, Anthropic) with debug logging
- Public helpers:
    available_providers() -> dict[name, provider_class]
    provider_names() -> list[name]
    get_provider(name) -> provider_class
    get_default_provider() -> provider_class
    create_provider(name, **kwargs) -> instance
    create_default_provider(**kwargs) -> instance

Environment:
- ORCHESTRATOR_LLM_PROVIDER = openai | anthropic | alias (e.g. gpt, claude)
- ORCHESTRATOR_DEBUG_IMPORTS=1 to see import diagnostics
"""

import os
import sys
from typing import Any, Dict, List, Optional, Type

from .base import LLMResponse, LLMProvider, _stub_reply, stub_enabled  # re-exported

# ------------------------------------------------------------------------------
# Debug logging
# ------------------------------------------------------------------------------
_DEBUG = str(os.getenv("ORCHESTRATOR_DEBUG_IMPORTS", "")).strip().lower() not in {"", "0", "false"}

def _log(*parts: Any) -> None:
    if _DEBUG:
        print("[orchestrator.providers]", *parts, file=sys.stderr)

# ------------------------------------------------------------------------------
# Optional provider imports
# ------------------------------------------------------------------------------
OpenAIProvider = None  # type: ignore[assignment]
AnthropicProvider = None  # type: ignore[assignment]

try:  # common name
    from .openai_provider import OpenAIProvider as _OpenAIProvider  # type: ignore
    OpenAIProvider = _OpenAIProvider
    _log("Loaded OpenAIProvider from 'openai_provider'.")
except Exception as e_outer:
    try:  # alternate file name
        from .openai import OpenAIProvider as _OpenAIProvider  # type: ignore
        OpenAIProvider = _OpenAIProvider
        _log("Loaded OpenAIProvider from 'openai'.")
    except Exception as e_inner:
        _log("OpenAI provider not available:", repr(e_outer))

try:
    from .anthropic_provider import AnthropicProvider as _AnthropicProvider  # type: ignore
    AnthropicProvider = _AnthropicProvider
    _log("Loaded AnthropicProvider from 'anthropic_provider'.")
except Exception as e_outer:
    try:
        from .anthropic import AnthropicProvider as _AnthropicProvider  # type: ignore
        AnthropicProvider = _AnthropicProvider
        _log("Loaded AnthropicProvider from 'anthropic'.")
    except Exception as e_inner:
        _log("Anthropic provider not available:", repr(e_outer))

# ------------------------------------------------------------------------------
# Name normalization & availability
# ------------------------------------------------------------------------------
_CANONICAL: Dict[str, str] = {
    # OpenAI
    "openai": "openai",
    "oai": "openai",
    "gpt": "openai",
    # Anthropic
    "anthropic": "anthropic",
    "claude": "anthropic",
}

def _canonicalize(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    key = str(name).strip().lower()
    return _CANONICAL.get(key, key)

def available_providers() -> Dict[str, Type[LLMProvider]]:
    """
    Return mapping of provider name -> provider class for providers that are importable now.
    """
    out: Dict[str, Type[LLMProvider]] = {}
    if OpenAIProvider is not None:  # type: ignore[truthy-bool]
        out["openai"] = OpenAIProvider  # type: ignore[assignment]
    if AnthropicProvider is not None:  # type: ignore[truthy-bool]
        out["anthropic"] = AnthropicProvider  # type: ignore[assignment]
    return out

def provider_names() -> List[str]:
    """
    Deterministic list of available provider names, with any env-preferred one first.
    """
    names: List[str] = []
    env_name = _canonicalize(os.getenv("ORCHESTRATOR_LLM_PROVIDER"))
    avail = available_providers()

    if env_name and env_name in avail:
        names.append(env_name)
    for n in ("openai", "anthropic"):
        if n in avail and n not in names:
            names.append(n)
    # future extra providers: keep stable order otherwise
    for n in sorted(k for k in avail.keys() if k not in names):
        names.append(n)
    return names

# ------------------------------------------------------------------------------
# Resolution helpers
# ------------------------------------------------------------------------------
def get_provider(name: Optional[str], *, raise_on_missing: bool = True) -> Optional[Type[LLMProvider]]:
    """
    Resolve a provider class by name ('openai' | 'anthropic' | alias). Returns the
    class or None (when raise_on_missing=False and not available).
    """
    canonical = _canonicalize(name)
    avail = available_providers()
    if canonical in avail:
        return avail[canonical]  # type: ignore[return-value]
    if raise_on_missing:
        raise ImportError(
            f"LLM provider '{name}' is not available. Available: {', '.join(avail) or 'none'}."
        )
    return None

def get_default_provider_name() -> Optional[str]:
    """
    Honor ORCHESTRATOR_LLM_PROVIDER, else prefer the first available in this order:
    'openai', then 'anthropic'. Returns None if none are importable.
    """
    env_name = _canonicalize(os.getenv("ORCHESTRATOR_LLM_PROVIDER"))
    avail = available_providers()
    if env_name and env_name in avail:
        return env_name
    for n in ("openai", "anthropic"):
        if n in avail:
            return n
    return None

def get_default_provider(*, raise_on_missing: bool = True) -> Optional[Type[LLMProvider]]:
    """
    Return the default provider class based on environment/configuration.
    """
    name = get_default_provider_name()
    if not name:
        if raise_on_missing:
            raise ImportError("No LLM providers are available; cannot get default provider.")
        return None
    return get_provider(name, raise_on_missing=raise_on_missing)

# ------------------------------------------------------------------------------
# Instantiation helpers (optional quality-of-life)
# ------------------------------------------------------------------------------
def create_provider(name: str, /, **kwargs: Any) -> LLMProvider:
    """
    Instantiate a provider by name, forwarding kwargs to the provider constructor.
    """
    cls = get_provider(name, raise_on_missing=True)
    assert cls is not None  # for type-checkers
    return cls(**kwargs)  # type: ignore[misc]

def create_default_provider(**kwargs: Any) -> LLMProvider:
    """
    Instantiate the default provider chosen by get_default_provider_name().
    """
    cls = get_default_provider(raise_on_missing=True)
    assert cls is not None  # for type-checkers
    return cls(**kwargs)  # type: ignore[misc]

# ------------------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------------------
__all__ = [
    # base
    "LLMResponse",
    "LLMProvider",
    "_stub_reply",
    "stub_enabled",
    # concrete providers (optional)
    "OpenAIProvider",
    "AnthropicProvider",
    # helpers
    "available_providers",
    "provider_names",
    "get_provider",
    "get_default_provider_name",
    "get_default_provider",
    "create_provider",
    "create_default_provider",
]
