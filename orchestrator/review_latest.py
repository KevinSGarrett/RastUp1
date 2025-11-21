# review_latest.py
from __future__ import annotations
"""
Orchestrator: compile a dual review (assistant‑manager + primary‑decider) for the latest run report.

Key updates in this version:
- **Model normalization + fallbacks**:
  - Transparently map unavailable/legacy names (e.g., "gpt-5", "claude-3-5-sonnet") to working defaults
    and try an ordered list of **configurable** fallbacks before stubbing.
  - Env overrides: ORCHESTRATOR_OPENAI_FALLBACK_MODELS, ORCHESTRATOR_ANTHROPIC_FALLBACK_MODELS
    (comma-separated), and CLI flags --openai-fallbacks / --anthropic-fallbacks.
- **OpenAI SDK detection**: cleanly separate new (>=1.x) and legacy (<1.0) codepaths.
  We only use the legacy ChatCompletion API **iff** a genuine legacy SDK is detected.
  API errors (e.g., invalid model) no longer trigger a mistaken fallback to the legacy path.
- **Standardized response metadata**: latency_ms, tokens, provider, model, and vendor_raw in LLMResponse.raw.
- **Safer retries**: retry per-(provider, model) with backoff; then advance to next fallback model.
- **Logs**: clearer, with explicit model fallback attempts and outcomes.
- Everything else remains compatible: latest aliases, copy/symlink behavior, CLI/env overrides, prompt truncation fence‑balancing, etc.
"""

import argparse
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional, Any, Tuple, List, Iterable

from .model_router import ModelRouter
from .providers.base import _stub_reply, LLMResponse

# ------------------------------------------------------------------------------
# Config / Paths (env-defaults; can be overridden via CLI flags)
# ------------------------------------------------------------------------------

RUN_DIR = Path(os.getenv("ORCHESTRATOR_RUN_DIR", "docs/runs"))
OUT_DIR = Path(os.getenv("ORCHESTRATOR_REVIEW_OUT_DIR", "docs/orchestrator/reviews"))
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADER = "# Orchestrator Review\n"

# Allow overriding the system prompts via env vars without changing code
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

# Tunables (env‑overridable; also CLI-overridable below)
MAX_PROMPT_CHARS = int(os.getenv("ORCHESTRATOR_MAX_PROMPT_CHARS", "120000"))  # guard ultra‑long reports
MAX_TOKENS = int(os.getenv("ORCHESTRATOR_MAX_TOKENS", "1500"))  # for providers that need it
RETRIES = int(os.getenv("ORCHESTRATOR_LLM_RETRIES", "2"))
USE_STUB = os.getenv("ORCHESTRATOR_LLM_STUB", "0") == "1"

# Model call controls
TEMPERATURE = float(os.getenv("ORCHESTRATOR_TEMPERATURE", "0.2"))
REQUEST_TIMEOUT = float(os.getenv("ORCHESTRATOR_LLM_TIMEOUT", "45"))  # seconds
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE")  # support either name
OPENAI_ORG = os.getenv("OPENAI_ORG_ID") or os.getenv("OPENAI_ORGANIZATION")
OPENAI_SEED = os.getenv("ORCHESTRATOR_SEED")
if OPENAI_SEED is not None:
    try:
        OPENAI_SEED = int(OPENAI_SEED)  # type: ignore[assignment]
    except Exception:
        OPENAI_SEED = None

# Run discovery controls
RUN_GLOB = os.getenv("ORCHESTRATOR_RUN_GLOB", "*.md")
RUN_RECURSIVE = os.getenv("ORCHESTRATOR_RUN_RECURSIVE", "0") == "1"
RUN_EXCLUDE_RE = os.getenv("ORCHESTRATOR_RUN_EXCLUDE_RE", r"^orchestrator-review-.*\.md$")
_RUN_EXCLUDE_RX = re.compile(RUN_EXCLUDE_RE)

# Output/loop-compatibility controls
LATEST_ALIAS_MODE = os.getenv("ORCHESTRATOR_LATEST_ALIAS_MODE", "copy")  # copy | symlink | none
LATEST_BASENAME = os.getenv("ORCHESTRATOR_LATEST_BASENAME", "latest.md")
WRITE_WBS_LATEST = os.getenv("ORCHESTRATOR_WRITE_WBS_LATEST", "1") == "1"
DEFAULT_OUT_FILE = os.getenv("ORCHESTRATOR_REVIEW_OUT_FILE", None)  # exact output path if set

# Model fallbacks (configurable)
def _parse_csv_env(name: str, default: str) -> List[str]:
    raw = os.getenv(name, default)
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    # dedupe while preserving order
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


# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------

_ANSI_RX = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")

def _strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences (common in terminal-captured logs)."""
    return _ANSI_RX.sub("", text)


def _balance_fences(head: str, tail: str) -> Tuple[str, str]:
    """
    If truncation splits inside a ``` fenced block, close in head and reopen in tail
    to avoid breaking the prompt structure for models.
    """
    head_fence_count = head.count("```")
    if head_fence_count % 2 == 1:
        head = head.rstrip() + "\n```"
        tail = "```\n" + tail.lstrip()
    return head, tail


def _latest_run_file(run_dir: Path = RUN_DIR) -> Path:
    """
    Discover the most recently modified run report markdown file.

    Honors:
      - ORCHESTRATOR_RUN_GLOB (default '*.md')
      - ORCHESTRATOR_RUN_RECURSIVE ('1' to search recursively)
      - ORCHESTRATOR_RUN_EXCLUDE_RE (regex; defaults to excluding generated reviews)
    """
    candidates: List[Path] = []
    iterator = run_dir.rglob(RUN_GLOB) if RUN_RECURSIVE else run_dir.glob(RUN_GLOB)
    for p in iterator:
        if not p.is_file():
            continue
        # Exclude our generated review outputs (and anything else the regex names).
        if _RUN_EXCLUDE_RX.search(p.name):
            continue
        candidates.append(p)

    candidates.sort(key=lambda p: (p.stat().st_mtime, p.stat().st_ctime), reverse=True)
    if not candidates:
        raise FileNotFoundError(f"No run reports found in {run_dir} (glob={RUN_GLOB}, recursive={RUN_RECURSIVE})")
    return candidates[0]


def _truncate_middle(text: str, max_chars: int) -> str:
    """Truncate very long text by keeping the head and tail, with a marker in the middle.
    Attempts to balance ``` fences if truncation happens inside a fenced block.
    Keeps overall length ≤ max_chars (best effort; fence balancing may add a few chars).
    """
    if len(text) <= max_chars:
        return text
    over_by = len(text) - max_chars
    placeholder = f"\n\n[... TRUNCATED {over_by} CHARS ...]\n\n"
    keep = max(max_chars - len(placeholder), 0)
    # Split evenly, bias a little toward head to preserve headings/context.
    head_len = (keep * 6) // 10
    tail_len = keep - head_len
    head = text[: max(head_len, 0)]
    tail = text[-max(tail_len, 0):]
    head, tail = _balance_fences(head, tail)  # balance fences if needed
    return f"{head}{placeholder}{tail}"


def _atomic_write(path: Path, data: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    tmp.replace(path)


def _normalize_model_name(provider: str, model: str) -> str:
    """Map known deprecated/placeholder names to working ones."""
    p = provider.lower()
    m = (model or "").strip()
    if p == "openai":
        # Map gpt-5 placeholder or obvious typos to gpt-4o(-mini)
        if m.lower() in {"gpt-5", "gpt5", "gpt-4.5", "gpt-4o-latest"}:
            return "gpt-4o-mini"
        return m or "gpt-4o-mini"
    if p == "anthropic":
        # Map generic/dated "sonnet" label to haiku variant that is widely available
        if m.lower() in {"claude-3-5-sonnet", "claude-3-sonnet", "sonnet"}:
            return "claude-3-5-haiku-20241022"
        return m or "claude-3-5-haiku-20241022"
    return m


def _provider_model_candidates(provider_name: str, initial_model: str) -> List[str]:
    """Return an ordered list: normalized initial model + provider-specific fallbacks."""
    base = _normalize_model_name(provider_name, initial_model)
    if provider_name == "openai":
        cands = [base] + [m for m in OPENAI_FALLBACK_MODELS if m != base]
    elif provider_name == "anthropic":
        cands = [base] + [m for m in ANTHROPIC_FALLBACK_MODELS if m != base]
    else:
        cands = [base]
    # de-duplicate while preserving order
    out: List[str] = []
    seen = set()
    for m in cands:
        if m and m not in seen:
            out.append(m)
            seen.add(m)
    return out


# --- helper: convert any LLM-like response to plain text -----------------------
def _to_text(x):
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    # Prefer string-ish attributes if present
    for attr in ("text", "content", "message", "output", "response"):
        try:
            v = getattr(x, attr)
        except Exception:
            v = None
        if isinstance(v, str):
            return v
    # If present but not a string, stringify
    for attr in ("text", "content"):
        try:
            v = getattr(x, attr)
        except Exception:
            v = None
        if v is not None:
            try:
                return str(v)
            except Exception:
                pass
    # Last resort
    try:
        return str(x)
    except Exception:
        return ""


# ------------------------------------------------------------------------------
# Provider calling with SDK detection + per-model fallbacks
# ------------------------------------------------------------------------------

def _have_openai_new_sdk(mod) -> bool:
    """Return True if openai>=1.x (new SDK) appears to be installed."""
    return hasattr(mod, "OpenAI")


def _call_openai_new(model: str, system: str, prompt: str) -> tuple[str, dict]:
    import openai  # >= 1.x
    client_kwargs: dict[str, Any] = {"api_key": os.getenv("OPENAI_API_KEY")}
    if not client_kwargs["api_key"]:
        raise RuntimeError("Missing OPENAI_API_KEY")
    if OPENAI_BASE_URL:
        client_kwargs["base_url"] = OPENAI_BASE_URL
    if OPENAI_ORG:
        client_kwargs["organization"] = OPENAI_ORG
    client = openai.OpenAI(**client_kwargs)

    create_kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
        "timeout": REQUEST_TIMEOUT,  # request option in new SDK
    }
    if OPENAI_SEED is not None:
        create_kwargs["seed"] = OPENAI_SEED

    resp = client.chat.completions.create(**create_kwargs)
    # Extract text (chat.completions)
    choice = resp.choices[0]
    text = getattr(choice.message, "content", None) or getattr(choice, "text", None) or ""
    usage = getattr(resp, "usage", None)
    tokens = getattr(usage, "total_tokens", None) if usage else None

    vendor_raw = resp.model_dump() if hasattr(resp, "model_dump") else resp
    meta = {
        "provider": "openai",
        "model": model,
        "tokens": tokens,
        "vendor_raw": vendor_raw,
    }
    return text, meta


def _call_openai_legacy(model: str, system: str, prompt: str) -> tuple[str, dict]:
    # Only invoked if truly on legacy openai<1.0
    import openai as openai_legacy  # type: ignore
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing OPENAI_API_KEY")
    openai_legacy.api_key = api_key
    if OPENAI_BASE_URL:
        openai_legacy.api_base = OPENAI_BASE_URL  # type: ignore[attr-defined]
    if OPENAI_ORG:
        openai_legacy.organization = OPENAI_ORG  # type: ignore[attr-defined]

    resp = openai_legacy.ChatCompletion.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        temperature=TEMPERATURE,
        max_tokens=MAX_TOKENS,
        request_timeout=REQUEST_TIMEOUT,
    )
    text = resp["choices"][0]["message"]["content"]
    tokens = resp.get("usage", {}).get("total_tokens")
    meta = {
        "provider": "openai",
        "model": model,
        "tokens": tokens,
        "vendor_raw": resp,
    }
    return text, meta


def _call_anthropic(model: str, system: str, prompt: str) -> tuple[str, dict]:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("Missing ANTHROPIC_API_KEY")
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    # Anthropic API (messages.create)
    msg = client.messages.create(
        model=model,
        system=system,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        # NOTE: anthropic SDK timeout control is at httpx client level; not passing here to keep compat.
    )
    # msg.content is a list of blocks; extract text
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

    meta = {
        "provider": "anthropic",
        "model": model,
        "tokens": tokens,
        "vendor_raw": msg.to_dict() if hasattr(msg, "to_dict") else msg,
    }
    return text, meta


def _call_provider_with_fallbacks(
    provider,
    requested_model: str,
    system: str,
    prompt: str,
    fallbacks: Optional[Iterable[str]] = None,
) -> LLMResponse:
    """
    Attempt provider call with requested_model, then any provided fallbacks.
    Retries per model up to RETRIES.
    Returns a best-effort LLMResponse; uses stub if all attempts fail or USE_STUB is set.
    """
    name = getattr(provider, "name", str(provider))
    candidates = [requested_model] + list(fallbacks or [])
    last_exc: Optional[Exception] = None

    if USE_STUB:
        text = _stub_reply(name, prompt)
        return LLMResponse(content=text, model=requested_model, raw={"provider": name, "model": requested_model, "note": "stubbed"})

    for model in candidates:
        attempt = 0
        while attempt <= RETRIES:
            start = time.time()
            try:
                if name == "openai":
                    try:
                        import openai as openai_pkg  # do not alias; we inspect it
                    except Exception as e:
                        raise RuntimeError(f"OpenAI SDK import failed: {e}") from e

                    if _have_openai_new_sdk(openai_pkg):
                        text, meta = _call_openai_new(model, system, prompt)
                    else:
                        text, meta = _call_openai_legacy(model, system, prompt)

                elif name == "anthropic":
                    text, meta = _call_anthropic(model, system, prompt)

                else:
                    # Unknown provider -> stub
                    text = _stub_reply(name, prompt)
                    latency_ms = int((time.time() - start) * 1000)
                    raw = {"provider": name, "model": model, "latency_ms": latency_ms, "note": "unknown provider; using stub"}
                    return LLMResponse(content=text, model=model, raw=raw)

                latency_ms = int((time.time() - start) * 1000)
                meta["latency_ms"] = latency_ms
                return LLMResponse(content=text, model=model, raw=meta)

            except Exception as e:
                last_exc = e
                attempt += 1
                # Decide whether to retry same model or move to next candidate
                if attempt <= RETRIES:
                    backoff = min(2 ** attempt, 8) + (0.05 * attempt)
                    log.warning(
                        f"[review_latest] {name}/{model} failed (attempt {attempt}/{RETRIES}): {e}. Retrying in {backoff:.2f}s …"
                    )
                    time.sleep(backoff)
                else:
                    # Out of retries for this model; move to next model candidate (if any)
                    log.warning(f"[review_latest] {name}/{model} exhausted retries: {e}. Trying next fallback (if any).")
                    break

        # next model candidate (continue loop)

    # All candidates failed -> stub
    text = f"{_stub_reply(name, prompt)} (fallback: {type(last_exc).__name__ if last_exc else 'UnknownError'})"
    return LLMResponse(content=text, model=candidates[0] if candidates else requested_model, raw={"provider": name, "model": requested_model, "note": "all candidates failed; stubbed"})


# ------------------------------------------------------------------------------
# Core review compilation
# ------------------------------------------------------------------------------

def compile_dual_review(report_md: str, router: ModelRouter, source: Optional[Path] = None) -> str:
    """Run assistant‑manager then primary‑decider and merge into one markdown document."""
    # Normalize + strip ANSI for safer prompts
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

    plan = router.providers_for_kind("review")
    if not plan:
        raise RuntimeError("ModelRouter.providers_for_kind('review') returned no providers")

    # Assistant‑manager: normalize model + add fallbacks
    am_provider, am_model = plan[0]
    am_provider_name = getattr(am_provider, "name", str(am_provider))
    am_candidates = _provider_model_candidates(am_provider_name, am_model)
    if len(am_candidates) > 1:
        log.info(f"[orchestrator.review_latest] Assistant‑manager models: {am_candidates[0]} (fallbacks: {am_candidates[1:]})")
    else:
        log.info(f"[orchestrator.review_latest] Assistant‑manager model: {am_candidates[0]}")

    am = _call_provider_with_fallbacks(
        am_provider,
        am_candidates[0],
        ASSISTANT_MANAGER_SYSTEM,
        am_prompt,
        fallbacks=am_candidates[1:],
    )

    # Primary decider: may use second provider/model or same as AM
    pd_provider, pd_model = plan[1] if len(plan) > 1 else plan[0]
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
        pd_provider,
        pd_candidates[0],
        PRIMARY_DECIDER_SYSTEM,
        pd_prompt,
        fallbacks=pd_candidates[1:],
    )

    # Expanded metadata block
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
    # Look across the entire path for WBS-<digits>
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
    """Maintain stable aliases so existing loops/pipelines keep working.

    Returns the list of alias paths successfully created.
    """
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
            # Clean old alias if exists
            if alias.exists() or alias.is_symlink():
                alias.unlink()
        except Exception as e:
            log.warning(f"[orchestrator.review_latest] Could not remove existing alias {alias}: {e}")

        if mode == "symlink":
            try:
                # Use a relative symlink where possible to be resilient to path moves
                rel_target = os.path.relpath(final_path, start=alias.parent)
                alias.symlink_to(rel_target)
                created.append(alias)
                continue
            except Exception as e:
                log.warning(
                    f"[orchestrator.review_latest] Symlink failed for {alias} -> {final_path}: {e}. Falling back to copy."
                )
                # fall through to copy

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
    """
    Core runner used by CLI and __main__.

    If report_text is provided, it takes precedence over reading from disk (useful for --stdin).
    """
    if report_text is not None:
        # When reading from stdin, we don't have a real file path; create a dummy for tag derivation.
        latest = Path(review_run_file) if review_run_file else Path("stdin.md")
        log.info("[orchestrator.review_latest] Using report content from STDIN/override")
        report_md = report_text
    else:
        latest = _resolve_run_file(review_run_file)
        log.info(f"[orchestrator.review_latest] Found run report: {latest}")
        report_md = latest.read_text(encoding="utf-8")

    router = ModelRouter()
    log.info("[orchestrator.review_latest] Using providers per policy (kind=review) …")

    merged = compile_dual_review(report_md, router, source=latest)  # pass source

    # Output path
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
        # Do not write; just print to stdout for piping/logging
        print(merged)
        return out_path

    _atomic_write(out_path, merged)
    log.info(f"[orchestrator.review_latest] Wrote orchestrator review to: {out_path}")

    if write_latest and out_file is None:
        # Maintain stable aliases only when we created a timestamped file; if the caller requested
        # an exact out_file, we assume they control the stable location.
        created = _write_latest_aliases(out_path, target_dir, wbs=wbs, mode=latest_mode)
        if created:
            joined = ", ".join(str(p) for p in created)
            log.info(f"[orchestrator.review_latest] Updated latest aliases: {joined}")

    return out_path


def _apply_cli_overrides(args: argparse.Namespace) -> None:
    """Apply CLI overrides to module-level defaults (keeps env as baseline)."""
    global MAX_PROMPT_CHARS, MAX_TOKENS, TEMPERATURE, REQUEST_TIMEOUT, OPENAI_BASE_URL, OPENAI_ORG
    global OPENAI_SEED, RUN_GLOB, RUN_RECURSIVE, RUN_EXCLUDE_RE, _RUN_EXCLUDE_RX
    global LATEST_BASENAME, WRITE_WBS_LATEST, USE_STUB, log
    global OPENAI_FALLBACK_MODELS, ANTHROPIC_FALLBACK_MODELS

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
        # Update root and module logger levels
        logging.getLogger().setLevel(args.log_level)
        log.setLevel(args.log_level)


def main():
    parser = argparse.ArgumentParser(
        description="Compile a dual review (assistant‑manager + primary‑decider) for the latest run."
    )
    # Input selection
    parser.add_argument(
        "--run-file",
        dest="run_file",
        default=None,
        help="Optional path to a specific run .md file (defaults to most recent in RUN_DIR).")
    parser.add_argument(
        "--stdin",
        action="store_true",
        help="Read the run report markdown from STDIN instead of disk (useful for piping).")

    # Output location and alias behavior
    parser.add_argument(
        "--out-dir",
        dest="out_dir",
        default=None,
        help="Override output directory (defaults to ORCHESTRATOR_REVIEW_OUT_DIR or docs/orchestrator/reviews).")
    parser.add_argument(
        "--out-file",
        dest="out_file",
        default=DEFAULT_OUT_FILE,
        help="Write to this exact path (also disables automatic latest-alias updates).")
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="Print the merged review to stdout instead of writing a file.")
    parser.add_argument(
        "--no-latest",
        action="store_true",
        help="Do not update stable latest aliases (latest.md, latest-<WBS>.md).")
    parser.add_argument(
        "--latest-mode",
        choices=["copy", "symlink", "none"],
        default=LATEST_ALIAS_MODE,
        help="How to maintain the stable latest aliases (default: %(default)s).")
    parser.add_argument(
        "--latest-basename",
        dest="latest_basename",
        default=None,
        help=f"Basename to use for the stable alias (default env ORCHESTRATOR_LATEST_BASENAME='{LATEST_BASENAME}').")
    parser.add_argument(
        "--wbs-latest",
        dest="wbs_latest",
        action="store_true",
        help="Also write latest-<WBS>.md alias.")
    parser.add_argument(
        "--no-wbs-latest",
        dest="wbs_latest",
        action="store_false",
        help="Do not write latest-<WBS>.md alias.")
    parser.set_defaults(wbs_latest=None)

    # LLM/provider behavior overrides
    parser.add_argument("--temperature", type=float, default=None, help="Sampling temperature (env ORCHESTRATOR_TEMPERATURE).")
    parser.add_argument("--timeout", type=float, dest="timeout", default=None, help="LLM request timeout in seconds (env ORCHESTRATOR_LLM_TIMEOUT).")
    parser.add_argument("--max-tokens", type=int, dest="max_tokens", default=None, help="Max tokens for providers that need it (env ORCHESTRATOR_MAX_TOKENS).")
    parser.add_argument("--max-prompt-chars", type=int, dest="max_prompt_chars", default=None, help="Max input chars (env ORCHESTRATOR_MAX_PROMPT_CHARS).")
    parser.add_argument("--seed", type=int, dest="seed", default=None, help="Optional deterministic seed (env ORCHESTRATOR_SEED).")
    parser.add_argument("--base-url", dest="base_url", default=None, help="OpenAI base URL override (env OPENAI_BASE_URL / OPENAI_API_BASE).")
    parser.add_argument("--org", dest="org", default=None, help="OpenAI organization override (env OPENAI_ORG_ID / OPENAI_ORGANIZATION).")
    parser.add_argument("--use-stub", action="store_true", help="Force stubbed LLM responses (same as env ORCHESTRATOR_LLM_STUB=1).")

    # Run discovery behavior
    parser.add_argument("--run-glob", dest="run_glob", default=None, help="Glob to locate run files (env ORCHESTRATOR_RUN_GLOB).")
    parser.add_argument(
        "--recursive",
        dest="recursive",
        action="store_true",
        help="Search recursively for run files (env ORCHESTRATOR_RUN_RECURSIVE).")
    parser.add_argument(
        "--no-recursive",
        dest="recursive",
        action="store_false",
        help="Do not search recursively for run files.")
    parser.set_defaults(recursive=None)
    parser.add_argument("--exclude-re", dest="exclude_re", default=None, help="Regex to exclude run files (env ORCHESTRATOR_RUN_EXCLUDE_RE).")

    # Model fallbacks
    parser.add_argument("--openai-fallbacks", dest="openai_fallbacks", default=None,
                        help="Comma-separated OpenAI fallback models (env ORCHESTRATOR_OPENAI_FALLBACK_MODELS).")
    parser.add_argument("--anthropic-fallbacks", dest="anthropic_fallbacks", default=None,
                        help="Comma-separated Anthropic fallback models (env ORCHESTRATOR_ANTHROPIC_FALLBACK_MODELS).")

    # Logging
    parser.add_argument("--log-level", dest="log_level", default=None, choices=["DEBUG", "INFO", "WARNING", "ERROR"], help="Log level (env ORCHESTRATOR_LOG_LEVEL).")

    args = parser.parse_args()

    try:
        # Apply CLI overrides on top of env defaults
        _apply_cli_overrides(args)

        report_text = None
        if args.stdin:
            # If STDIN is not a tty, read it; otherwise leave as None.
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
