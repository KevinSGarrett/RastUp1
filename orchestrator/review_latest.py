# orchestrator/review_latest.py
from __future__ import annotations
"""
Compile a dual review (assistant‑manager + primary‑decider) for the latest run report.

Fixes in this version:
- Accepts --am-provider/--am-model and --pd-provider/--pd-model (or env overrides).
- Robust OpenAI calling: supports gpt‑5 by sending max_completion_tokens or using Responses API.
- Keeps internal router fallback, truncation and ANSI stripping.
"""

import argparse
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Any, Tuple, List, Iterable

# --- optional imports of your internal plumbing -------------------------------
_HAVE_ROUTER = False
try:
    from .model_router import ModelRouter as _InternalModelRouter  # type: ignore
    _HAVE_ROUTER = True
except Exception:
    _InternalModelRouter = None  # type: ignore

try:
    from .providers.base import _stub_reply as _internal_stub_reply  # type: ignore
    from .providers.base import LLMResponse as _InternalLLMResponse  # type: ignore
except Exception:
    _internal_stub_reply = None
    _InternalLLMResponse = None  # type: ignore


# ------------------------------------------------------------------------------
# Local shims (used if internal ones are unavailable)
# ------------------------------------------------------------------------------

def _local_stub_reply(provider_name: str, prompt: str) -> str:
    return f"[stub:{provider_name}] No provider available; reviewed {min(len(prompt), 2000)} chars."

@dataclass
class LLMResponse:
    content: str
    model: str
    raw: dict

if _InternalLLMResponse is not None:
    LLMResponse = _InternalLLMResponse  # type: ignore[assignment]
if _internal_stub_reply is not None:
    _stub_reply = _internal_stub_reply  # type: ignore[assignment]
else:
    _stub_reply = _local_stub_reply


# ------------------------------------------------------------------------------
# Config / Paths
# ------------------------------------------------------------------------------

RUN_DIR = Path(os.getenv("ORCHESTRATOR_RUN_DIR", "docs/runs"))
OUT_DIR = Path(os.getenv("ORCHESTRATOR_REVIEW_OUT_DIR", "docs/orchestrator/reviews"))
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADER = "# Orchestrator Review\n"

ASSISTANT_MANAGER_SYSTEM = os.getenv(
    "ORCHESTRATOR_ASSISTANT_MANAGER_SYSTEM",
    (
        "You are the assistant‑manager reviewer. Critically review the agent run report, "
        "identify concrete risks, missing deliverables, and propose specific follow‑up tasks "
        "the orchestrator should queue. Output in markdown with the following sections:\n\n"
        "### Risk Log\n- [Severity] Risk statement …\n\n"
        "### Missing Deliverables\n- Deliverable name — why missing / evidence\n\n"
        "### Recommended Follow‑Ups\n- Task: …\n  - Rationale: …\n  - Owner: role or team\n  - Prereqs: …\n  - Est: S/M/L\n"
    ))

PRIMARY_DECIDER_SYSTEM = os.getenv(
    "ORCHESTRATOR_PRIMARY_DECIDER_SYSTEM",
    (
        "You are the orchestrator's primary reviewer/decider. Consider the assistant‑manager review, "
        "produce the final review with accept/reject decisions and a prioritized set of next actions "
        "for the orchestrator. Output in markdown with:\n\n"
        "### Decision\n- ACCEPT | REJECT and short justification\n\n"
        "### Prioritized Next Actions\n1) Action …\n   - Owner: …\n   - Due: YYYY‑MM‑DD (or 'ASAP')\n   - Acceptance Criteria: …\n   - Notes/Dependencies: …\n"
    ))

# Tunables
MAX_PROMPT_CHARS = int(os.getenv("ORCHESTRATOR_MAX_PROMPT_CHARS", "120000"))
MAX_TOKENS = int(os.getenv("ORCHESTRATOR_MAX_TOKENS", "1500"))
RETRIES = int(os.getenv("ORCHESTRATOR_LLM_RETRIES", "2"))
USE_STUB = os.getenv("ORCHESTRATOR_LLM_STUB", "0") == "1"

TEMPERATURE = float(os.getenv("ORCHESTRATOR_TEMPERATURE", "0.2"))
REQUEST_TIMEOUT = float(os.getenv("ORCHESTRATOR_LLM_TIMEOUT", "45"))  # seconds

OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE")
OPENAI_ORG = os.getenv("OPENAI_ORG_ID") or os.getenv("OPENAI_ORGANIZATION")
OPENAI_SEED = os.getenv("ORCHESTRATOR_SEED")
if OPENAI_SEED is not None:
    try:
        OPENAI_SEED = int(OPENAI_SEED)  # type: ignore[assignment]
    except Exception:
        OPENAI_SEED = None

RUN_GLOB = os.getenv("ORCHESTRATOR_RUN_GLOB", "*.md")
RUN_RECURSIVE = os.getenv("ORCHESTRATOR_RUN_RECURSIVE", "0") == "1"
RUN_EXCLUDE_RE = os.getenv("ORCHESTRATOR_RUN_EXCLUDE_RE", r"^orchestrator-review-.*\.md$")
_RUN_EXCLUDE_RX = re.compile(RUN_EXCLUDE_RE)

LATEST_ALIAS_MODE = os.getenv("ORCHESTRATOR_LATEST_ALIAS_MODE", "copy")  # copy | symlink | none
LATEST_BASENAME = os.getenv("ORCHESTRATOR_LATEST_BASENAME", "latest.md")
WRITE_WBS_LATEST = os.getenv("ORCHESTRATOR_WRITE_WBS_LATEST", "1") == "1"
DEFAULT_OUT_FILE = os.getenv("ORCHESTRATOR_REVIEW_OUT_FILE", None)  # exact output path if set

def _parse_csv_env(name: str, default: str) -> List[str]:
    raw = os.getenv(name, default)
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    seen = set()
    out: List[str] = []
    for p in parts:
        if p not in seen:
            out.append(p)
            seen.add(p)
    return out

OPENAI_FALLBACK_MODELS = _parse_csv_env(
    "ORCHESTRATOR_OPENAI_FALLBACK_MODELS",
    "gpt-4o-mini,gpt-4o,gpt-3.5-turbo",
)
ANTHROPIC_FALLBACK_MODELS = _parse_csv_env(
    "ORCHESTRATOR_ANTHROPIC_FALLBACK_MODELS",
    "claude-3-5-haiku-20241022,claude-3-haiku-20240307",
)

LOG_LEVEL = os.getenv("ORCHESTRATOR_LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="[%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# CLI provider/model overrides
AM_PROVIDER_OVERRIDE = os.getenv("ORCHESTRATOR_AM_PROVIDER", "").strip() or None
AM_MODEL_OVERRIDE = os.getenv("ORCHESTRATOR_AM_MODEL", "").strip() or None
PD_PROVIDER_OVERRIDE = os.getenv("ORCHESTRATOR_PD_PROVIDER", "").strip() or None
PD_MODEL_OVERRIDE = os.getenv("ORCHESTRATOR_PD_MODEL", "").strip() or None


# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------

_ANSI_RX = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")

def _strip_ansi(text: str) -> str:
    return _ANSI_RX.sub("", text)

def _balance_fences(head: str, tail: str) -> Tuple[str, str]:
    head_fence_count = head.count("```")
    if head_fence_count % 2 == 1:
        head = head.rstrip() + "\n```"
        tail = "```\n" + tail.lstrip()
    return head, tail

def _latest_run_file(run_dir: Path = RUN_DIR) -> Path:
    candidates: List[Path] = []
    iterator = run_dir.rglob(RUN_GLOB) if RUN_RECURSIVE else run_dir.glob(RUN_GLOB)
    for p in iterator:
        if not p.is_file():
            continue
        if _RUN_EXCLUDE_RX.search(p.name):
            continue
        candidates.append(p)
    candidates.sort(key=lambda p: (p.stat().st_mtime, p.stat().st_ctime), reverse=True)
    if not candidates:
        raise FileNotFoundError(f"No run reports found in {run_dir} (glob={RUN_GLOB}, recursive={RUN_RECURSIVE})")
    return candidates[0]

def _truncate_middle(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    over_by = len(text) - max_chars
    placeholder = f"\n\n[... TRUNCATED {over_by} CHARS ...]\n\n"
    keep = max(max_chars - len(placeholder), 0)
    head_len = (keep * 6) // 10
    tail_len = keep - head_len
    head = text[: max(head_len, 0)]
    tail = text[-max(tail_len, 0):]
    head, tail = _balance_fences(head, tail)
    return f"{head}{placeholder}{tail}"

def _atomic_write(path: Path, data: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    tmp.replace(path)

def _normalize_model_name(provider: str, model: str) -> str:
    p = provider.lower()
    m = (model or "").strip()
    if p == "openai":
        if m.lower() in {"gpt-5", "gpt5", "gpt-4.5", "gpt-4o-latest"}:
            return m  # keep exact; we'll adjust params below
        return m or "gpt-4o-mini"
    if p == "anthropic":
        if m.lower() in {"claude-3-5-sonnet", "claude-3-sonnet", "sonnet"}:
            return "claude-3-5-haiku-20241022"
        return m or "claude-3-5-haiku-20241022"
    return m

def _provider_model_candidates(provider_name: str, initial_model: str) -> List[str]:
    base = _normalize_model_name(provider_name, initial_model)
    if provider_name == "openai":
        cands = [base] + [m for m in OPENAI_FALLBACK_MODELS if m != base]
    elif provider_name == "anthropic":
        cands = [base] + [m for m in ANTHROPIC_FALLBACK_MODELS if m != base]
    else:
        cands = [base]
    out: List[str] = []
    seen = set()
    for m in cands:
        if m and m not in seen:
            out.append(m)
            seen.add(m)
    return out

def _to_text(x):
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    for attr in ("text", "content", "message", "output", "response"):
        v = getattr(x, attr, None)
        if isinstance(v, str):
            return v
    for attr in ("text", "content"):
        v = getattr(x, attr, None)
        if v is not None:
            try:
                return str(v)
            except Exception:
                pass
    try:
        return str(x)
    except Exception:
        return ""


# ------------------------------------------------------------------------------
# Provider calling with SDK detection + per-model fallbacks
# ------------------------------------------------------------------------------

def _have_openai_new_sdk(mod) -> bool:
    return hasattr(mod, "OpenAI")

def _call_openai_chat_or_responses(model: str, system: str, prompt: str) -> tuple[str, dict]:
    """
    Handles OpenAI 2.x SDK:
      - Uses Responses API for gpt-5 if available (max_output_tokens)
      - Otherwise uses Chat Completions, and for gpt-5 sends extra_body={"max_completion_tokens": ...}
    """
    import openai  # >= 1.x
    client_kwargs: dict[str, Any] = {"api_key": os.getenv("OPENAI_API_KEY")}
    if not client_kwargs["api_key"]:
        raise RuntimeError("Missing OPENAI_API_KEY")
    if OPENAI_BASE_URL:
        client_kwargs["base_url"] = OPENAI_BASE_URL
    if OPENAI_ORG:
        client_kwargs["organization"] = OPENAI_ORG
    client = openai.OpenAI(**client_kwargs)

    m = (model or "").lower()
    try_responses = "gpt-5" in m or os.getenv("ORCHESTRATOR_USE_RESPONSES", "0") == "1"

    if try_responses and hasattr(client, "responses"):
        # Responses API
        resp = client.responses.create(
            model=model,
            input=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=TEMPERATURE,
            max_output_tokens=MAX_TOKENS,
            timeout=REQUEST_TIMEOUT,
            **({"metadata": {"orchestrator": "review_latest"}}),
        )
        text = (getattr(resp, "output_text", None) or
                _to_text(resp))
        vendor_raw = resp.model_dump() if hasattr(resp, "model_dump") else resp
        return text, {"provider": "openai", "model": model, "vendor_raw": vendor_raw}

    # Chat Completions API fallback
    create_kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": TEMPERATURE,
        "timeout": REQUEST_TIMEOUT,
    }
    # gpt-5 rejects max_tokens; it wants max_completion_tokens (server-side quirk you hit)
    # For other models keep using max_tokens.
    if "gpt-5" in m:
        create_kwargs["extra_body"] = {"max_completion_tokens": MAX_TOKENS}
    else:
        create_kwargs["max_tokens"] = MAX_TOKENS

    resp = client.chat.completions.create(**create_kwargs)
    choice = resp.choices[0]
    text = getattr(choice.message, "content", None) or getattr(choice, "text", None) or ""
    usage = getattr(resp, "usage", None)
    tokens = getattr(usage, "total_tokens", None) if usage else None
    vendor_raw = resp.model_dump() if hasattr(resp, "model_dump") else resp
    meta = {"provider": "openai", "model": model, "tokens": tokens, "vendor_raw": vendor_raw}
    return text, meta


def _call_anthropic(model: str, system: str, prompt: str) -> tuple[str, dict]:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("Missing ANTHROPIC_API_KEY")
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=model,
        system=system,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
    )
    try:
        text = "".join(getattr(blk, "text", "") for blk in msg.content)
    except Exception:
        text = str(msg.content)
    tokens = None
    if hasattr(msg, "usage"):
        try:
            tokens = msg.usage.input_tokens + msg.usage.output_tokens  # type: ignore[attr-defined]
        except Exception:
            tokens = None

    meta = {"provider": "anthropic", "model": model, "tokens": tokens,
            "vendor_raw": msg.to_dict() if hasattr(msg, "to_dict") else msg}
    return text, meta


def _call_provider_with_fallbacks(
    provider,
    requested_model: str,
    system: str,
    prompt: str,
    fallbacks: Optional[Iterable[str]] = None,
) -> LLMResponse:
    name = getattr(provider, "name", str(provider))
    candidates = [requested_model] + list(fallbacks or [])
    last_exc: Optional[Exception] = None

    if USE_STUB:
        text = _stub_reply(name, prompt)
        return LLMResponse(content=text, model=requested_model,
                           raw={"provider": name, "model": requested_model, "note": "stubbed"})

    for model in candidates:
        attempt = 0
        while attempt <= RETRIES:
            start = time.time()
            try:
                if name == "openai":
                    text, meta = _call_openai_chat_or_responses(model, system, prompt)
                elif name == "anthropic":
                    text, meta = _call_anthropic(model, system, prompt)
                else:
                    text = _stub_reply(name, prompt)
                    latency_ms = int((time.time() - start) * 1000)
                    raw = {"provider": name, "model": model, "latency_ms": latency_ms,
                           "note": "unknown provider; using stub"}
                    return LLMResponse(content=text, model=model, raw=raw)

                latency_ms = int((time.time() - start) * 1000)
                meta["latency_ms"] = latency_ms
                return LLMResponse(content=text, model=model, raw=meta)

            except Exception as e:
                last_exc = e
                attempt += 1
                if attempt <= RETRIES:
                    backoff = min(2 ** attempt, 8) + (0.05 * attempt)
                    log.warning(
                        f"[review_latest] {name}/{model} failed (attempt {attempt}/{RETRIES}): {e}. Retrying in {backoff:.2f}s …"
                    )
                    time.sleep(backoff)
                else:
                    log.warning(f"[review_latest] {name}/{model} exhausted retries: {e}. Trying next fallback (if any).")
                    break

    text = f"{_stub_reply(name, prompt)} (fallback: {type(last_exc).__name__ if last_exc else 'UnknownError'})"
    return LLMResponse(content=text, model=candidates[0] if candidates else requested_model,
                       raw={"provider": name, "model": requested_model, "note": "all candidates failed; stubbed"})


# ------------------------------------------------------------------------------
# Router (internal or fallback) + CLI overrides
# ------------------------------------------------------------------------------

class _SimpleProvider:
    def __init__(self, name: str):
        self.name = name

class _FallbackRouter:
    def providers_for_kind(self, kind: str):
        return [
            (_SimpleProvider("openai"), "gpt-4o-mini"),
            (_SimpleProvider("anthropic"), "claude-3-5-haiku-20241022"),
        ]

def _get_router():
    if _HAVE_ROUTER and _InternalModelRouter is not None:
        try:
            return _InternalModelRouter()
        except Exception as e:
            log.warning(f"[review_latest] Internal ModelRouter failed to init ({e}); using fallback router.")
    return _FallbackRouter()


def _plan_providers_with_overrides() -> List[tuple]:
    """
    Build [(provider, model), (provider, model)] using router or CLI/env overrides.
    """
    router = _get_router()
    plan = router.providers_for_kind("review")
    # apply AM override to first leg
    am_provider, am_model = plan[0]
    if AM_PROVIDER_OVERRIDE:
        am_provider = _SimpleProvider(AM_PROVIDER_OVERRIDE)
    if AM_MODEL_OVERRIDE:
        am_model = AM_MODEL_OVERRIDE
    # PD is second leg or fallback to first
    pd_provider, pd_model = (plan[1] if len(plan) > 1 else plan[0])
    if PD_PROVIDER_OVERRIDE:
        pd_provider = _SimpleProvider(PD_PROVIDER_OVERRIDE)
    if PD_MODEL_OVERRIDE:
        pd_model = PD_MODEL_OVERRIDE
    return [(am_provider, am_model), (pd_provider, pd_model)]


# ------------------------------------------------------------------------------
# Core review compilation
# ------------------------------------------------------------------------------

def compile_dual_review(report_md: str, source: Optional[Path] = None) -> str:
    normalized = _strip_ansi(report_md).replace("\r\n", "\n")
    truncated_chars = max(0, len(normalized) - MAX_PROMPT_CHARS)
    safe_report = _truncate_middle(normalized, MAX_PROMPT_CHARS)

    am_prompt = (
        "Review the following agent run report. Identify concrete risks, missing deliverables, "
        "and propose actionable follow‑ups the orchestrator should queue.\n\n"
        "----- BEGIN REPORT -----\n"
        f"{safe_report}\n"
        "----- END REPORT -----"
    )

    plan = _plan_providers_with_overrides()
    if not plan:
        raise RuntimeError("providers_for_kind('review') returned no providers")

    am_provider, am_model = plan[0]
    am_provider_name = getattr(am_provider, "name", str(am_provider))
    am_candidates = _provider_model_candidates(am_provider_name, am_model)
    if len(am_candidates) > 1:
        log.info(f"[orchestrator.review_latest] Assistant‑manager models: {am_candidates[0]} (fallbacks: {am_candidates[1:]})")
    else:
        log.info(f"[orchestrator.review_latest] Assistant‑manager model: {am_candidates[0]}")

    am = _call_provider_with_fallbacks(
        am_provider, am_candidates[0], ASSISTANT_MANAGER_SYSTEM, am_prompt, fallbacks=am_candidates[1:]
    )

    pd_provider, pd_model = plan[1]
    pd_provider_name = getattr(pd_provider, "name", str(pd_provider))
    pd_candidates = _provider_model_candidates(pd_provider_name, pd_model)
    if len(pd_candidates) > 1:
        log.info(f"[orchestrator.review_latest] Primary‑decider models: {pd_candidates[0]} (fallbacks: {pd_candidates[1:]})")
    else:
        log.info(f"[orchestrator.review_latest] Primary‑decider model: {pd_candidates[0]}")

    pd_prompt = (
        f"{_to_text(am)}\n\n"
        "Now decide: accept or reject the work, and output a prioritized list of next actions "
        "for the orchestrator with owners and due dates when possible."
    )

    pd = _call_provider_with_fallbacks(
        pd_provider, pd_candidates[0], PRIMARY_DECIDER_SYSTEM, pd_prompt, fallbacks=pd_candidates[1:]
    )

    src_label = str(source) if source is not None else "STDIN/override"

    def _meta_line(tag: str, resp: LLMResponse) -> str:
        raw = getattr(resp, "raw", {}) or {}
        provider = raw.get("provider", "?")
        model = getattr(resp, "model", None) or raw.get("model", "?")
        latency = raw.get("latency_ms", "?")
        tokens = raw.get("tokens", None)
        tok_str = f", tokens={tokens}" if tokens is not None else ""
        return f"- {tag}: **{provider}/{model}** ({latency} ms){tok_str}"

    meta = [
        f"- Source: **{src_label}**",
        f"- Input size: **{len(normalized)} chars**" + (f" (truncated: {truncated_chars})" if truncated_chars > 0 else ""),
        _meta_line("Assistant‑manager", am),
        _meta_line("Primary‑decider", pd),
    ]

    merged = [
        HEADER,
        *meta,
        "\n## Assistant‑Manager Review\n",
        _to_text(am).strip(),
        "\n## Final Orchestrator Decision\n",
        _to_text(pd).strip(),
        "",
    ]
    return "\n".join(merged)


def _derive_wbs_tag(path: Path) -> str:
    m = re.search(r"(WBS-\d+)", str(path))
    return m.group(1) if m else "RUN"


def _resolve_run_file(cli_run_file: Optional[str]) -> Path:
    if cli_run_file:
        p = Path(cli_run_file)
        if not p.exists():
            raise FileNotFoundError(f"Run report not found: {p}")
        return p
    return _latest_run_file(RUN_DIR)


def _write_latest_aliases(final_path: Path, target_dir: Path, wbs: str, mode: str) -> list[Path]:
    created: list[Path] = []
    if mode not in {"copy", "symlink", "none"}:
        log.warning(f"[orchestrator.review_latest] Unknown latest alias mode '{mode}', defaulting to 'copy'")
        mode = "copy"
    if mode == "none":
        return created

    aliases = [target_dir / LATEST_BASENAME]
    if WRITE_WBS_LATEST:
        aliases.append(target_dir / f"latest-{wbs}.md")

    for alias in aliases:
        try:
            if alias.exists() or alias.is_symlink():
                alias.unlink()
        except Exception as e:
            log.warning(f"[orchestrator.review_latest] Could not remove existing alias {alias}: {e}")

        if mode == "symlink":
            try:
                rel_target = os.path.relpath(final_path, start=alias.parent)
                alias.symlink_to(rel_target)
                created.append(alias)
                continue
            except Exception as e:
                log.warning(
                    f"[orchestrator.review_latest] Symlink failed for {alias} -> {final_path}: {e}. Falling back to copy."
                )

        try:
            data = final_path.read_bytes()
            alias.write_bytes(data)
            created.append(alias)
        except Exception as e:
            log.error(f"[orchestrator.review_latest] Failed to write alias {alias}: {e}")

    return created


def run(
    review_run_file: Optional[str] = None,
    out_dir: Optional[str] = None,
    print_only: bool = False,
    report_text: Optional[str] = None,
    out_file: Optional[str] = DEFAULT_OUT_FILE,
    latest_mode: str = LATEST_ALIAS_MODE,
    write_latest: bool = True) -> Path:

    if report_text is not None:
        latest = Path(review_run_file) if review_run_file else Path("stdin.md")
        log.info("[orchestrator.review_latest] Using report content from STDIN/override")
        report_md = report_text
    else:
        latest = _resolve_run_file(review_run_file)
        log.info(f"[orchestrator.review_latest] Found run report: {latest}")
        report_md = latest.read_text(encoding="utf-8")

    merged = compile_dual_review(report_md, source=latest)

    target_dir = Path(out_dir) if out_dir else OUT_DIR
    target_dir.mkdir(parents=True, exist_ok=True)

    wbs = _derive_wbs_tag(latest)
    ts = time.strftime("%Y%m%d-%H%M%SZ", time.gmtime())

    if out_file:
        out_path = Path(out_file)
        out_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        out_path = target_dir / f"orchestrator-review-{wbs}-{ts}.md"

    if print_only:
        print(merged)
        return out_path

    _atomic_write(out_path, merged)
    log.info(f"[orchestrator.review_latest] Wrote orchestrator review to: {out_path}")

    if write_latest and out_file is None:
        created = _write_latest_aliases(out_path, target_dir, wbs=wbs, mode=latest_mode)
        if created:
            joined = ", ".join(str(p) for p in created)
            log.info(f"[orchestrator.review_latest] Updated latest aliases: {joined}")

    return out_path


def _apply_cli_overrides(args: argparse.Namespace) -> None:
    global MAX_PROMPT_CHARS, MAX_TOKENS, TEMPERATURE, REQUEST_TIMEOUT, OPENAI_BASE_URL, OPENAI_ORG
    global OPENAI_SEED, RUN_GLOB, RUN_RECURSIVE, RUN_EXCLUDE_RE, _RUN_EXCLUDE_RX
    global LATEST_BASENAME, WRITE_WBS_LATEST, USE_STUB, log
    global OPENAI_FALLBACK_MODELS, ANTHROPIC_FALLBACK_MODELS
    global AM_PROVIDER_OVERRIDE, AM_MODEL_OVERRIDE, PD_PROVIDER_OVERRIDE, PD_MODEL_OVERRIDE

    if args.max_prompt_chars is not None:
        MAX_PROMPT_CHARS = args.max_prompt_chars
    if args.max_tokens is not None:
        MAX_TOKENS = args.max_tokens
    if args.temperature is not None:
        TEMPERATURE = args.temperature
    if args.timeout is not None:
        REQUEST_TIMEOUT = args.timeout
    if args.base_url is not None:
        OPENAI_BASE_URL = args.base_url
    if args.org is not None:
        OPENAI_ORG = args.org
    if args.seed is not None:
        OPENAI_SEED = args.seed

    if args.run_glob is not None:
        RUN_GLOB = args.run_glob
    if args.recursive is not None:
        RUN_RECURSIVE = args.recursive
    if args.exclude_re is not None:
        RUN_EXCLUDE_RE = args.exclude_re
        _RUN_EXCLUDE_RX = re.compile(RUN_EXCLUDE_RE)

    if args.latest_basename is not None:
        LATEST_BASENAME = args.latest_basename
    if args.wbs_latest is not None:
        WRITE_WBS_LATEST = args.wbs_latest

    if args.use_stub:
        USE_STUB = True

    if args.openai_fallbacks is not None:
        OPENAI_FALLBACK_MODELS = [m.strip() for m in args.openai_fallbacks.split(",") if m.strip()]
    if args.anthropic_fallbacks is not None:
        ANTHROPIC_FALLBACK_MODELS = [m.strip() for m in args.anthropic_fallbacks.split(",") if m.strip()]

    if args.log_level is not None:
        logging.getLogger().setLevel(args.log_level)
        log.setLevel(args.log_level)

    # Provider/model overrides
    if args.am_provider:
        AM_PROVIDER_OVERRIDE = args.am_provider
    if args.am_model:
        AM_MODEL_OVERRIDE = args.am_model
    if args.pd_provider:
        PD_PROVIDER_OVERRIDE = args.pd_provider
    if args.pd_model:
        PD_MODEL_OVERRIDE = args.pd_model


def main():
    parser = argparse.ArgumentParser(
        description="Compile a dual review (assistant‑manager + primary‑decider) for the latest run."
    )
    # Input selection
    parser.add_argument("--run-file", dest="run_file", default=None,
                        help="Optional path to a specific run .md file (defaults to most recent in RUN_DIR).")
    parser.add_argument("--stdin", action="store_true",
                        help="Read the run report markdown from STDIN instead of disk (useful for piping).")

    # Output / aliasing
    parser.add_argument("--out-dir", dest="out_dir", default=None,
                        help="Override output directory (defaults to ORCHESTRATOR_REVIEW_OUT_DIR or docs/orchestrator/reviews).")
    parser.add_argument("--out-file", dest="out_file", default=DEFAULT_OUT_FILE,
                        help="Write to this exact path (disables automatic latest-alias updates).")
    parser.add_argument("--print-only", action="store_true",
                        help="Print the merged review to stdout instead of writing a file.")
    parser.add_argument("--no-latest", action="store_true",
                        help="Do not update stable latest aliases (latest.md, latest-<WBS>.md).")
    parser.add_argument("--latest-mode", choices=["copy", "symlink", "none"], default=LATEST_ALIAS_MODE,
                        help="How to maintain the stable latest aliases (default: %(default)s).")
    parser.add_argument("--latest-basename", dest="latest_basename", default=None,
                        help=f"Basename for the stable alias (default env ORCHESTRATOR_LATEST_BASENAME='{LATEST_BASENAME}').")
    parser.add_argument("--wbs-latest", dest="wbs_latest", action="store_true",
                        help="Also write latest-<WBS>.md alias.")
    parser.add_argument("--no-wbs-latest", dest="wbs_latest", action="store_false",
                        help="Do not write latest-<WBS>.md alias.")
    parser.set_defaults(wbs_latest=None)

    # LLM/provider behavior
    parser.add_argument("--temperature", type=float, default=None, help="Sampling temperature.")
    parser.add_argument("--timeout", type=float, dest="timeout", default=None, help="LLM request timeout in seconds.")
    parser.add_argument("--max-tokens", type=int, dest="max_tokens", default=None, help="Max tokens/output tokens.")
    parser.add_argument("--max-prompt-chars", type=int, dest="max_prompt_chars", default=None, help="Max input chars.")
    parser.add_argument("--seed", type=int, dest="seed", default=None, help="Optional deterministic seed.")
    parser.add_argument("--base-url", dest="base_url", default=None, help="OpenAI base URL override.")
    parser.add_argument("--org", dest="org", default=None, help="OpenAI organization override.")
    parser.add_argument("--use-stub", action="store_true", help="Force stubbed LLM responses.")

    # Run discovery behavior
    parser.add_argument("--run-glob", dest="run_glob", default=None, help="Glob to locate run files.")
    parser.add_argument("--recursive", dest="recursive", action="store_true", help="Search recursively for run files.")
    parser.add_argument("--no-recursive", dest="recursive", action="store_false", help="Do not search recursively for run files.")
    parser.set_defaults(recursive=None)
    parser.add_argument("--exclude-re", dest="exclude_re", default=None, help="Regex to exclude run files.")

    # Model fallbacks
    parser.add_argument("--openai-fallbacks", dest="openai_fallbacks", default=None,
                        help="Comma-separated OpenAI fallback models.")
    parser.add_argument("--anthropic-fallbacks", dest="anthropic_fallbacks", default=None,
                        help="Comma-separated Anthropic fallback models.")

    # Logging
    parser.add_argument("--log-level", dest="log_level", default=None,
                        choices=["DEBUG", "INFO", "WARNING", "ERROR"], help="Log level.")

    # NEW: direct provider/model overrides (match your usage)
    parser.add_argument("--am-provider", dest="am_provider", default=None, help="Assistant‑manager provider (openai|anthropic).")
    parser.add_argument("--am-model", dest="am_model", default=None, help="Assistant‑manager model name.")
    parser.add_argument("--pd-provider", dest="pd_provider", default=None, help="Primary‑decider provider (openai|anthropic).")
    parser.add_argument("--pd-model", dest="pd_model", default=None, help="Primary‑decider model name.")

    args = parser.parse_args()

    try:
        _apply_cli_overrides(args)

        report_text = None
        if args.stdin:
            if sys.stdin is not None and not sys.stdin.isatty():
                report_text = sys.stdin.read()
            else:
                log.error("[orchestrator.review_latest] --stdin specified but no STDIN data was provided.")
                sys.exit(2)

        run(
            review_run_file=args.run_file,
            out_dir=args.out_dir,
            print_only=args.print_only,
            report_text=report_text,
            out_file=args.out_file,
            latest_mode=args.latest_mode,
            write_latest=not args.no_latest)
    except Exception as e:
        log.error(f"[orchestrator.review_latest] Failed: {e}")
        raise


if __name__ == "__main__":
    main()
