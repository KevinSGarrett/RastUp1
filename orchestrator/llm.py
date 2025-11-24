from __future__ import annotations

import json
import logging
import os
from typing import Dict, List, Optional, Tuple

from openai import OpenAI

try:
    from anthropic import Anthropic
except Exception:
    Anthropic = None  # Anthropic client optional

# --------------------------------------------------------------------------------------
# Defaults (overridable via environment)
# --------------------------------------------------------------------------------------
# High‑end OpenAI model used as the "manager" / primary decider.
DEFAULT_OAI_MODEL = os.getenv("ORCHESTRATOR_MODEL_HIGH", "gpt-5")

# Anthropic model used as assistant‑manager / second opinion. We default to a
# model we know works on your account; you can override via ORCHESTRATOR_ANTHROPIC_MODEL.
DEFAULT_ANTHROPIC_MODEL = os.getenv(
    "ORCHESTRATOR_ANTHROPIC_MODEL", "claude-3-5-haiku-20241022"
)

OAI_MAX_TOKENS = int(os.getenv("ORCHESTRATOR_OPENAI_MAX_TOKENS", "2048"))
ANTHROPIC_MAX_TOKENS = int(os.getenv("ORCHESTRATOR_ANTHROPIC_MAX_TOKENS", "1024"))
TEMPERATURE = float(os.getenv("ORCHESTRATOR_TEMPERATURE", "0.0"))

# If set to 1/true, force using the Responses API for OpenAI instead of Chat Completions.
OAI_FORCE_RESPONSES = os.getenv("OAI_FORCE_RESPONSES", "0").lower() in {"1", "true", "yes"}
# If set to 0/false, skip Anthropic entirely (even if installed).
USE_ANTHROPIC = os.getenv("USE_ANTHROPIC", "1").lower() not in {"0", "false", "no"}

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------------------
# Utilities
# --------------------------------------------------------------------------------------
def _flatten_messages(messages: List[Dict[str, str]]) -> str:
    """
    Turn a list of OpenAI-style messages into a single text block.
    Useful for APIs that accept a single text input (e.g., OpenAI Responses fallback).
    """
    parts: List[str] = []
    for m in messages:
        role = (m.get("role", "user") or "user").upper()
        content = m.get("content", "") or ""
        parts.append(f"{role}: {content}")
    return "\n\n".join(parts)


def _extract_json_from_text(text: str) -> Optional[dict]:
    """
    Robustly pull a JSON object out of a string. Handles code fences and extra prose.
    Returns None if parsing fails.
    """
    if not text:
        return None

    s = text.strip()

    # Common case: ```json ... ```
    if "```" in s:
        # Try each fenced block in order
        import re

        blocks = re.findall(r"```(?:json)?\s*([\s\S]*?)```", s, flags=re.MULTILINE)
        for block in blocks:
            try:
                return json.loads(block.strip())
            except Exception:
                pass  # try the next block

    # Fallback: try substring between the first '{' and the last '}'
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = s[start : end + 1]
        try:
            return json.loads(candidate)
        except Exception:
            pass

    # Last resort: try raw text
    try:
        return json.loads(s)
    except Exception:
        return None


def _anthropic_available() -> bool:
    if not USE_ANTHROPIC:
        return False
    if Anthropic is None:
        return False
    # Respect env var presence to avoid late failures
    return bool(os.getenv("ANTHROPIC_API_KEY"))


# --------------------------------------------------------------------------------------
# OpenAI
# --------------------------------------------------------------------------------------
def call_openai(messages: List[Dict[str, str]], model: Optional[str] = None) -> str:
    """
    Calls OpenAI with robust fallback:
      1) Try Chat Completions API
      2) On known errors (or if forced), use the Responses API with flattened input
    Returns trimmed text. Raises if both attempts fail.
    """
    client = OpenAI()
    m = model or DEFAULT_OAI_MODEL

    def _responses_call() -> str:
        text = _flatten_messages(messages)
        r = client.responses.create(model=m, input=text, max_output_tokens=OAI_MAX_TOKENS)
        # Robustly extract text for multiple SDK shapes
        try:
            out = getattr(r, "output_text", None)
            if out:
                return out.strip()
        except Exception:
            pass
        try:
            # Some SDKs expose r.output -> list of parts with .content[].text
            parts = []
            for item in getattr(r, "output", []) or []:
                for c in getattr(item, "content", []) or []:
                    t = getattr(c, "text", None)
                    if t:
                        parts.append(t)
                    elif isinstance(c, dict) and c.get("type") == "output_text":
                        parts.append(str(c.get("text", "")))
            if parts:
                return "\n".join(p for p in parts if p).strip()
        except Exception:
            pass
        # Worst case, string-ify
        return str(r).strip()

    # If forced by env, skip directly to Responses API
    if OAI_FORCE_RESPONSES:
        return _responses_call()

    # Try Chat Completions first
    try:
        resp = client.chat.completions.create(
            model=m,
            messages=messages,
            temperature=TEMPERATURE,
            max_tokens=OAI_MAX_TOKENS,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception as e:
        msg = (str(e) or "").lower()
        # Known migration error or any hint to use Responses API
        if "only supported in v1/responses" in msg or "responses" in msg:
            logger.info("Falling back to OpenAI Responses API due to: %s", e)
            return _responses_call()
        logger.warning("OpenAI chat.completions failed: %s", e)
        # As a last attempt, try Responses anyway
        try:
            return _responses_call()
        except Exception:
            # Re-raise the original error for observability
            raise


# --------------------------------------------------------------------------------------
# Anthropic (optional)
# --------------------------------------------------------------------------------------
def call_anthropic(messages: List[Dict[str, str]], model: Optional[str] = None) -> Optional[str]:
    """
    Calls Anthropic if available/enabled.
    Returns text (str) on success, or None if Anthropic unavailable or call fails.
    """
    if not _anthropic_available():
        if USE_ANTHROPIC:
            logger.warning("Anthropic client unavailable or ANTHROPIC_API_KEY not set; skipping.")
        return None

    client = Anthropic()
    m = model or DEFAULT_ANTHROPIC_MODEL

    # Convert OpenAI-style messages into a compact “single user text” + optional system.
    system = None
    parts: List[str] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "") or ""
        if role == "system":
            system = f"{system}\n{content}" if system else content
        else:
            parts.append(f"{role.upper()}: {content}")
    user_text = "\n\n".join(parts) if parts else ""

    try:
        resp = client.messages.create(
            model=m,
            max_tokens=ANTHROPIC_MAX_TOKENS,
            system=system or "You are a precise, concise senior engineer reviewer.",
            messages=[{"role": "user", "content": user_text}],
        )
        # Extract textual content across SDK shapes
        try:
            chunks: List[str] = []
            for block in getattr(resp, "content", []) or []:
                t = getattr(block, "text", None)
                if t:
                    chunks.append(t)
                elif isinstance(block, dict) and block.get("type") == "text":
                    chunks.append(str(block.get("text", "")))
            if chunks:
                return "\n".join(chunks).strip()
        except Exception:
            pass
        return str(resp).strip()
    except Exception as e:
        logger.warning("Anthropic call failed (%s); continuing without it.", e)
        return None


# --------------------------------------------------------------------------------------
# Dual complete: primary (OpenAI) + second-opinion (Anthropic)
# --------------------------------------------------------------------------------------
def dual_complete(
    messages: List[Dict[str, str]],
    model_oai: Optional[str] = None,
    model_anthropic: Optional[str] = None,
) -> Tuple[str, Optional[dict]]:
    """
    Primary completion by OpenAI, second-opinion by Anthropic.
    Returns (final_text, second_opinion_json_or_none).

    If the second opinion returns {"decision":"revise", "suggested_answer":"..."},
    the final_text is replaced with the suggested answer.
    """
    primary = call_openai(messages, model=model_oai).strip()

    critic_prompt = [
        {
            "role": "system",
            "content": (
                "You are the assistant manager reviewer. Read the primary answer and return a compact JSON with fields: "
                "decision ('accept'|'revise'), reasons (array of short strings), suggested_answer (string, may be empty if accept). "
                "Return ONLY JSON, no prose."
            ),
        },
        {"role": "user", "content": json.dumps({"primary_answer": primary})},
    ]

    sop: Optional[dict] = None
    second_text = call_anthropic(critic_prompt, model=model_anthropic)
    if second_text:
        sop = _extract_json_from_text(second_text)

    final = primary
    if sop and isinstance(sop, dict) and sop.get("decision") == "revise" and sop.get("suggested_answer"):
        final = str(sop["suggested_answer"]).strip()

    return final, sop


# --------------------------------------------------------------------------------------
# Guarded review: short, actionable review with explicit decision lines
# --------------------------------------------------------------------------------------
def guarded_review(
    run_report_text: str,
    model_oai: Optional[str] = None,
    model_anthropic: Optional[str] = None,
) -> str:
    """
    Produce a short, actionable review. Always end with:
      - exactly one 'ACCEPTANCE:' line ('met' or 'unmet — <reason>')
      - exactly one 'Decision:' line ('done' or 'in_progress')
    If acceptance criteria are not explicitly met, default to in_progress.
    """
    base_messages = [
        {
            "role": "system",
            "content": (
                "You are a senior orchestrator reviewer. Be brief, concrete, and checklist-driven. "
                "If acceptance criteria are not explicitly met, default to in_progress."
            ),
        },
        {
            "role": "user",
            "content": (
                "Review this run-report and produce:\n"
                "- 3-8 bullet 'What to fix' (if any)\n"
                "- 'ACCEPTANCE: met' or 'ACCEPTANCE: unmet — <short reason>'\n"
                "- final one-liner 'Decision: done' or 'Decision: in_progress'\n\n"
                f"Run report:\n---\n{run_report_text}\n---"
            ),
        },
    ]
    oai_only = call_openai(base_messages, model=model_oai)

    merge_messages = [
        {
            "role": "system",
            "content": (
                "You are the assistant manager reviewer. Tighten the review below. Ensure exactly one 'ACCEPTANCE:' line "
                "and exactly one 'Decision:' line. Choose 'done' only if acceptance is clearly 'met'."
            ),
        },
        {"role": "user", "content": oai_only},
    ]
    merged = call_anthropic(merge_messages, model=model_anthropic) or oai_only

    text = (merged or "").strip()

    # Normalize: ensure exactly one ACCEPTANCE and one Decision line
    if "ACCEPTANCE:" not in text:
        text += "\n\nACCEPTANCE: unmet — reviewer did not find explicit acceptance proof."
    if "Decision:" not in text:
        text += "\n\nDecision: in_progress"

    return text
