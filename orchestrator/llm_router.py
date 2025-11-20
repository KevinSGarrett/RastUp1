# orchestrator/llm_router.py
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Union

# Providers factory (already in your repo)
try:
    from orchestrator.providers import get_provider, create_default_provider
except Exception:  # pragma: no cover
    get_provider = None  # type: ignore
    create_default_provider = None  # type: ignore


@dataclass
class LLMResult:
    """Normalized LLM response."""
    text: str = ""
    model: Optional[str] = None
    provider: str = "unknown"
    usage: Dict[str, Any] = field(default_factory=dict)


class _StubProvider:
    """
    Built-in fallback provider for local/dev/testing.
    Echoes back prompts/messages so the router & CLI are testable without keys.
    """

    def __init__(self, *_, **__):
        pass

    def complete(self, prompt: str, model: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        text = f"[stub:{model or 'default'}] {prompt}"
        return {"text": text, "model": model or "stub-default", "usage": {"prompt_tokens": len(prompt)}}

    def chat(self, messages: List[Dict[str, str]], model: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        last = ""
        if isinstance(messages, list) and messages:
            last = messages[-1].get("content", "")
        text = f"[stub:{model or 'default'}] {last}"
        return {"text": text, "model": model or "stub-default", "usage": {"message_count": len(messages)}}


def _first(*values: Any) -> Any:
    for v in values:
        if v is not None:
            return v
    return None


def coerce_to_result(provider_name: str, model: Optional[str], response: Any) -> LLMResult:
    """
    Best-effort normalization across provider return shapes:
    - None                        -> empty text
    - str                         -> text
    - object with .text/.content  -> text
    - dict with 'text'/'content'  -> text
    - OpenAI-like: {'choices':[{'text' or {'message':{'content'}}}], 'model', 'usage'}
    """
    text: str = ""
    usage: Dict[str, Any] = {}

    # None
    if response is None:
        return LLMResult(text="", model=model, provider=provider_name, usage={})

    # String-like
    if isinstance(response, str):
        return LLMResult(text=response, model=model, provider=provider_name, usage={})

    # Dict-like
    if isinstance(response, dict):
        text = (
            response.get("text")
            or response.get("content")
            or _extract_from_choices(response.get("choices"))
            or ""
        )
        model = _first(response.get("model"), model)
        usage = response.get("usage") or {}
        return LLMResult(text=str(text or ""), model=model, provider=provider_name, usage=usage)

    # Object with attributes (.text / .content / .choices etc.)
    # Try attributes commonly exposed by SDKs
    for attr in ("text", "content"):
        if hasattr(response, attr):
            val = getattr(response, attr)
            if isinstance(val, str):
                return LLMResult(text=val, model=model, provider=provider_name, usage=usage)

    # OpenAI-like ChatCompletion objects
    if hasattr(response, "choices"):
        choices = getattr(response, "choices")
        text = _extract_from_choices(choices) or ""
    if hasattr(response, "model"):
        model = _first(getattr(response, "model"), model)
    if hasattr(response, "usage"):
        usage = getattr(response, "usage") or {}

    return LLMResult(text=str(text or ""), model=model, provider=provider_name, usage=usage)


def _extract_from_choices(choices: Any) -> Optional[str]:
    """
    Extract text/content from an OpenAI-style choices array.
    Handles:
      [{'text': '...'}]  (legacy completions)
      [{'message': {'content': '...'}}]  (chat)
    """
    if not choices or not isinstance(choices, (list, tuple)):
        return None
    first = choices[0]
    if isinstance(first, dict):
        if isinstance(first.get("message"), dict):
            return first["message"].get("content")
        if isinstance(first.get("delta"), dict):  # streaming deltas – just in case
            return first["delta"].get("content")
        if first.get("text") is not None:
            return first.get("text")
    # Some SDKs wrap .message on objects, not dict
    if hasattr(first, "message") and hasattr(first.message, "content"):
        return getattr(first.message, "content")
    if hasattr(first, "text"):
        return getattr(first, "text")
    return None


class LLMRouter:
    """
    Simple provider router. Tries a named provider, else defaults, else stub.
    """

    def __init__(self, provider_name: Optional[str] = None, model: Optional[str] = None):
        self.provider_name = (provider_name or
                              os.getenv("ORCHESTRATOR_DEFAULT_PROVIDER") or
                              "auto")
        self.model = model or os.getenv("ORCHESTRATOR_DEFAULT_MODEL") or None
        self._provider = self._load_provider(self.provider_name)

    # -- public API ---------------------------------------------------------

    def complete(self, prompt: str, **kwargs) -> LLMResult:
        model = kwargs.pop("model", None) or self.model
        provider_name = self.provider_name
        provider = self._provider

        # Prefer a 'complete' style if present; else try 'chat'
        try:
            if hasattr(provider, "complete"):
                resp = provider.complete(prompt, model=model, **kwargs)
            elif hasattr(provider, "chat"):
                messages = [{"role": "user", "content": prompt}]
                resp = provider.chat(messages, model=model, **kwargs)
            else:
                resp = None
        except Exception:  # don’t crash CLI/tests if a provider misbehaves
            resp = None

        return coerce_to_result(provider_name, model, resp)

    def chat(self, messages: List[Dict[str, str]], **kwargs) -> LLMResult:
        model = kwargs.pop("model", None) or self.model
        provider_name = self.provider_name
        provider = self._provider

        try:
            if hasattr(provider, "chat"):
                resp = provider.chat(messages, model=model, **kwargs)
            elif hasattr(provider, "complete"):
                # flatten messages to a single prompt (last user message)
                last = ""
                if messages and isinstance(messages, list):
                    last = messages[-1].get("content", "")
                resp = provider.complete(last, model=model, **kwargs)
            else:
                resp = None
        except Exception:
            resp = None

        return coerce_to_result(provider_name, model, resp)

    # -- internals ----------------------------------------------------------

    @staticmethod
    def _load_provider(name: str):
        name = (name or "").lower()
        if name in ("stub", "fake", "echo"):
            return _StubProvider()

        # If orchestrator.providers is available, try to load
        if get_provider is not None:
            try:
                return get_provider(name)() if name not in ("", "auto") else None
            except Exception:
                pass

        # Try default provider factory if "auto" or resolving by env
        if (name in ("", "auto") or name is None) and create_default_provider is not None:
            try:
                provider = create_default_provider()
                if provider:
                    return provider
            except Exception:
                pass

        # Fall back to stub
        return _StubProvider()


def get_router(provider_name: Optional[str] = None, model: Optional[str] = None) -> LLMRouter:
    """
    Factory used by code and tests.
    """
    return LLMRouter(provider_name=provider_name, model=model)


# ----------------------------- CLI support ----------------------------------

def _parse_cli(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Lightweight LLM router CLI")
    p.add_argument("prompt", nargs="?", help="Single-turn prompt text.")
    p.add_argument("--messages", help="JSON array of messages: [{role, content}, ...].")
    p.add_argument("-p", "--provider", help="Provider name (openai, anthropic, stub, ...).")
    p.add_argument("-m", "--model", help="Model id/name to use.")
    p.add_argument("--temperature", type=float, default=None)
    p.add_argument("--max-tokens", type=int, default=None)
    p.add_argument("--as-json", action="store_true", help="Emit machine-readable JSON.")
    return p.parse_args(list(argv) if argv is not None else None)


def _main(argv: Optional[Iterable[str]] = None) -> int:
    args = _parse_cli(argv)

    router = get_router(provider_name=args.provider, model=args.model)

    # Prefer --messages if present; else use positional prompt
    if args.messages:
        try:
            messages = json.loads(args.messages)
            if not isinstance(messages, list):
                raise ValueError("messages must be a JSON array")
        except Exception as e:
            print(f"Invalid --messages JSON: {e}", file=sys.stderr)
            return 2
        result = router.chat(messages, temperature=args.temperature, max_tokens=args.max_tokens)
    else:
        prompt = args.prompt or ""
        result = router.complete(prompt, temperature=args.temperature, max_tokens=args.max_tokens)

    if args.as_json:
        print(json.dumps({
            "text": result.text,
            "model": result.model,
            "provider": result.provider,
            "usage": result.usage,
        }))
    else:
        print(result.text or "")

    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_main())
