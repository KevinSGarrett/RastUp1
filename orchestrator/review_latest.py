from __future__ import annotations
"""
Orchestrator: compile a dual review (assistant‑manager + primary‑decider) for the latest run report.

This version:
- Accepts --am-provider/--am-model/--pd-provider/--pd-model overrides.
- Works with OpenAI v1 SDK (chat.completions for classic models; Responses API for models like gpt‑5/gpt‑4.1).
- Handles max_tokens vs max_(completion|output)_tokens automatically.
- Never needs --root (paths come from env or defaults).
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

# Optional internal router
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


# ----------------------------
# Config / Paths
# ----------------------------
RUN_DIR = Path(os.getenv("ORCHESTRATOR_RUN_DIR", "docs/runs"))
OUT_DIR = Path(os.getenv("ORCHESTRATOR_REVIEW_OUT_DIR", "docs/orchestrator/reviews"))
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADER = "# Orchestrator Review\n"

ASSISTANT_MANAGER_SYSTEM = os.getenv(
    "ORCHESTRATOR_ASSISTANT_MANAGER_SYSTEM",
    (
        "You are the assistant‑manager reviewer. Critically review the agent run report, "
        "identify concrete risks, missing deliverables, and propose specific follow‑up tasks "
        "the orchestrator should queue. Output in markdown with sections: Risk Log, Missing Deliverables, Recommended Follow‑Ups."
    ),
)

PRIMARY_DECIDER_SYSTEM = os.getenv(
    "ORCHESTRATOR_PRIMARY_DECIDER_SYSTEM",
    (
        "You are the orchestrator's primary reviewer/decider. Consider the assistant‑manager review, "
        "produce the final review with accept/reject decisions and a prioritized set of next actions."
    ),
)

# Tunables
MAX_PROMPT_CHARS = int(os.getenv("ORCHESTRATOR_MAX_PROMPT_CHARS", "120000"))
MAX_TOKENS = int(os.getenv("ORCHESTRATOR_MAX_TOKENS", "1500"))
RETRIES = int(os.getenv("ORCHESTRATOR_LLM_RETRIES", "2"))
USE_STUB = os.getenv("ORCHESTRATOR_LLM_STUB", "0") == "1"

TEMPERATURE = float(os.getenv("ORCHESTRATOR_TEMPERATURE", "0.2"))
REQUEST_TIMEOUT = float(os.getenv("ORCHESTRATOR_LLM_TIMEOUT", "45"))  # seconds

OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE")
OPENAI_ORG = os.getenv("OPENAI_ORG_ID") or os.getenv("OPENAI_ORGANIZATION")
OPENAI_SEED: Optional[int] = os.getenv("ORCHESTRATOR_SEED")  # type: ignore[assignment]
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

OPENAI_FALLBACK_MODELS = [
    m
    for m in (
        os.getenv("ORCHESTRATOR_OPENAI_FALLBACK_MODELS", "gpt-5,gpt-4.1,gpt-4o,gpt-4o-mini").split(",")
    )
    if m.strip()
]
ANTHROPIC_FALLBACK_MODELS = [
    m
    for m in (
        os.getenv(
            "ORCHESTRATOR_ANTHROPIC_FALLBACK_MODELS",
            "claude-3-5-sonnet-20241022,claude-3-5-haiku-20241022",
        ).split(",")
    )
    if m.strip()
]

LOG_LEVEL = os.getenv("ORCHESTRATOR_LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="[%(levelname)s] %(message)s")
log = logging.getLogger(__name__)


# ----------------------------
# Helpers
# ----------------------------
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
        raise FileNotFoundError(
            f"No run reports found in {run_dir} (glob={RUN_GLOB}, recursive={RUN_RECURSIVE})"
        )
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
    tail = text[-max(tail_len, 0) :]
    head, tail = _balance_fences(head, tail)
    return f"{head}{placeholder}{tail}"


def _atomic_write(path: Path, data: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    tmp.replace(path)


def _to_text(x):
    if x is None:
        return ""
    if isinstance(x, str):
        return x
    for attr in ("text", "content", "message", "output", "response"):
        try:
            v = getattr(x, attr)
        except Exception:
            v = None
        if isinstance(v, str):
            return v
    try:
        return str(x)
    except Exception:
        return ""


# ----------------------------
# Provider calling
# ----------------------------
def _model_needs_responses_api(model: str) -> bool:
    m = (model or "").lower()
    return m.startswith("gpt-5") or m.startswith("gpt-4.1")


def _call_openai(model: str, system: str, prompt: str) -> tuple[str, dict]:
    import openai

    client_kwargs: dict[str, Any] = {"api_key": os.getenv("OPENAI_API_KEY")}
    if not client_kwargs["api_key"]:
        raise RuntimeError("Missing OPENAI_API_KEY")
    if OPENAI_BASE_URL:
        client_kwargs["base_url"] = OPENAI_BASE_URL
    if OPENAI_ORG:
        client_kwargs["organization"] = OPENAI_ORG
    client = openai.OpenAI(**client_kwargs)

    if _model_needs_responses_api(model):
        # Responses API (for gpt‑5/gpt‑4.1 style models)
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ]
        try:
            resp = client.responses.create(
                model=model,
                input=messages,
                temperature=TEMPERATURE,
                max_output_tokens=MAX_TOKENS,
                timeout=REQUEST_TIMEOUT,
            )
        except Exception:
            # Some deployments expect max_completion_tokens
            resp = client.responses.create(
                model=model,
                input=messages,
                temperature=TEMPERATURE,
                max_completion_tokens=MAX_TOKENS,
                timeout=REQUEST_TIMEOUT,
            )
        text = getattr(resp, "output_text", None)
        if not text:
            # Older SDK shapes:
            try:
                parts: List[str] = []
                for block in getattr(resp, "output", []):
                    for c in getattr(block, "content", []):
                        t = getattr(c, "text", None)
                        if t:
                            parts.append(t)
                text = "\n".join(parts)
            except Exception:
                text = str(resp)
        vendor_raw = resp.model_dump() if hasattr(resp, "model_dump") else resp
        return text, {"provider": "openai", "model": model, "vendor_raw": vendor_raw}

    # Chat Completions (classic)
    create_kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
        "timeout": REQUEST_TIMEOUT,
    }
    if OPENAI_SEED is not None:
        create_kwargs["seed"] = OPENAI_SEED

    resp = client.chat.completions.create(**create_kwargs)
    choice = resp.choices[0]
    text = (
        getattr(choice.message, "content", None)
        or getattr(choice, "text", None)
        or ""
    )
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

    meta = {
        "provider": "anthropic",
        "model": model,
        "vendor_raw": msg.to_dict() if hasattr(msg, "to_dict") else msg,
    }
    return text, meta


class _SimpleProvider:
    def __init__(self, name: str):
        self.name = name


class _FallbackRouter:
    def __init__(self, override_plan: Optional[List[tuple]] = None):
        self._override_plan = override_plan

    def providers_for_kind(self, kind: str):
        if self._override_plan:
            return self._override_plan
        return [
            (_SimpleProvider("openai"), "gpt-4o-mini"),
            (_SimpleProvider("anthropic"), "claude-3-5-haiku-20241022"),
        ]


def _get_router(override_plan: Optional[List[tuple]] = None):
    """
    Return either:
    - an internal ModelRouter() if available, or
    - a simple fallback router (optionally seeded with an override plan).
    """
    if override_plan:
        return _FallbackRouter(override_plan)
    if _HAVE_ROUTER and _InternalModelRouter is not None:
        try:
            return _InternalModelRouter()
        except Exception as e:
            log.warning(
                f"[review_latest] Internal ModelRouter failed to init ({e}); using fallback router."
            )
    return _FallbackRouter()


def _provider_model_candidates(provider_name: str, initial_model: str) -> List[str]:
    if provider_name == "openai":
        base = initial_model or "gpt-4o-mini"
        cands = [base] + [m for m in OPENAI_FALLBACK_MODELS if m != base]
    elif provider_name == "anthropic":
        base = initial_model or "claude-3-5-haiku-20241022"
        cands = [base] + [m for m in ANTHROPIC_FALLBACK_MODELS if m != base]
    else:
        cands = [initial_model]
    out: List[str] = []
    seen = set()
    for m in cands:
        if m and m not in seen:
            out.append(m)
            seen.add(m)
    return out


def _call_with_fallbacks(
    provider_name: str,
    requested_model: str,
    system: str,
    prompt: str,
    fallbacks: Optional[Iterable[str]] = None,
) -> LLMResponse:
    name = provider_name
    candidates = [requested_model] + list(fallbacks or [])
    last_exc: Optional[Exception] = None

    if USE_STUB:
        text = _stub_reply(name, prompt)
        return LLMResponse(
            content=text,
            model=requested_model,
            raw={
                "provider": name,
                "model": requested_model,
                "note": "stubbed",
            },
        )

    for model in candidates:
        attempt = 0
        while attempt <= RETRIES:
            start = time.time()
            try:
                if name == "openai":
                    text, meta = _call_openai(model, system, prompt)
                elif name == "anthropic":
                    text, meta = _call_anthropic(model, system, prompt)
                else:
                    text = _stub_reply(name, prompt)
                    latency_ms = int((time.time() - start) * 1000)
                    raw = {
                        "provider": name,
                        "model": model,
                        "latency_ms": latency_ms,
                        "note": "unknown provider; stub",
                    }
                    return LLMResponse(content=text, model=model, raw=raw)

                latency_ms = int((time.time() - start) * 1000)
                meta["latency_ms"] = latency_ms
                return LLMResponse(content=text, model=model, raw=meta)

            except Exception as e:
                last_exc = e
                attempt += 1
                if attempt <= RETRIES:
                    backoff = min(2**attempt, 8) + (0.05 * attempt)
                    log.warning(
                        f"[review_latest] {name}/{model} failed (attempt {attempt}/{RETRIES}): {e}. "
                        f"Retrying in {backoff:.2f}s …"
                    )
                    time.sleep(backoff)
                else:
                    log.warning(
                        f"[review_latest] {name}/{model} exhausted retries: {e}. "
                        "Trying next fallback (if any)."
                    )
                    break

    text = f"{_stub_reply(name, prompt)} (fallback: {type(last_exc).__name__ if last_exc else 'UnknownError'})"
    return LLMResponse(
        content=text,
        model=candidates[0] if candidates else requested_model,
        raw={
            "provider": name,
            "model": requested_model,
            "note": "all candidates failed; stubbed",
        },
    )


def compile_dual_review(
    report_md: str,
    source: Optional[Path] = None,
    plan_override: Optional[List[tuple]] = None,
) -> str:
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

    router = _get_router(plan_override)
    plan = router.providers_for_kind("review")
    if not plan:
        raise RuntimeError("providers_for_kind('review') returned no providers")

    # Assistant‑manager (usually Anthropic or OpenAI, depending on router)
    am_provider, am_model = plan[0]
    am_provider_name = getattr(am_provider, "name", str(am_provider))
    am_candidates = _provider_model_candidates(am_provider_name, am_model)
    if len(am_candidates) > 1:
        log.info(
            "[orchestrator.review_latest] Assistant‑manager models: "
            f"{am_candidates[0]} (fallbacks: {am_candidates[1:]})"
        )
    else:
        log.info(
            "[orchestrator.review_latest] Assistant‑manager model: "
            f"{am_candidates[0]}"
        )

    am = _call_with_fallbacks(
        am_provider_name,
        am_candidates[0],
        ASSISTANT_MANAGER_SYSTEM,
        am_prompt,
        fallbacks=am_candidates[1:],
    )

    # Primary decider
    pd_provider, pd_model = plan[1] if len(plan) > 1 else plan[0]
    pd_provider_name = getattr(pd_provider, "name", str(pd_provider))
    pd_candidates = _provider_model_candidates(pd_provider_name, pd_model)
    if len(pd_candidates) > 1:
        log.info(
            "[orchestrator.review_latest] Primary‑decider models: "
            f"{pd_candidates[0]} (fallbacks: {pd_candidates[1:]})"
        )
    else:
        log.info(
            "[orchestrator.review_latest] Primary‑decider model: "
            f"{pd_candidates[0]}"
        )

    pd_prompt = (
        f"{_to_text(am)}\n\n"
        "Now decide: accept or reject the work, and output a prioritized list of next actions "
        "for the orchestrator with owners and due dates when possible."
    )
    pd = _call_with_fallbacks(
        pd_provider_name,
        pd_candidates[0],
        PRIMARY_DECIDER_SYSTEM,
        pd_prompt,
        fallbacks=pd_candidates[1:],
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
        f"- Input size: **{len(normalized)} chars**"
        + (f" (truncated: {truncated_chars})" if truncated_chars > 0 else ""),
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


def _write_latest_aliases(
    final_path: Path, target_dir: Path, wbs: str, mode: str
) -> list[Path]:
    created: list[Path] = []
    if mode not in {"copy", "symlink", "none"}:
        log.warning(
            f"[orchestrator.review_latest] Unknown latest alias mode '{mode}', "
            "defaulting to 'copy'"
        )
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
            log.warning(
                f"[orchestrator.review_latest] Could not remove existing alias {alias}: {e}"
            )

        if mode == "symlink":
            try:
                rel_target = os.path.relpath(final_path, start=alias.parent)
                alias.symlink_to(rel_target)
                created.append(alias)
                continue
            except Exception as e:
                log.warning(
                    "[orchestrator.review_latest] Symlink failed for "
                    f"{alias} -> {final_path}: {e}. Falling back to copy."
                )

        try:
            data = final_path.read_bytes()
            alias.write_bytes(data)
            created.append(alias)
        except Exception as e:
            log.error(
                f"[orchestrator.review_latest] Failed to write alias {alias}: {e}"
            )

    return created


def run(
    review_run_file: Optional[str] = None,
    out_dir: Optional[str] = None,
    print_only: bool = False,
    report_text: Optional[str] = None,
    out_file: Optional[str] = DEFAULT_OUT_FILE,
    latest_mode: str = LATEST_ALIAS_MODE,
    write_latest: bool = True,
    plan_override: Optional[List[tuple]] = None,
) -> Path:
    if report_text is not None:
        latest = Path(review_run_file) if review_run_file else Path("stdin.md")
        log.info(
            "[orchestrator.review_latest] Using report content from STDIN/override"
        )
        report_md = report_text
    else:
        latest = _resolve_run_file(review_run_file)
        log.info(f"[orchestrator.review_latest] Found run report: {latest}")
        report_md = latest.read_text(encoding="utf-8")

    merged = compile_dual_review(
        report_md, source=latest, plan_override=plan_override
    )

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
    log.info(
        f"[orchestrator.review_latest] Wrote orchestrator review to: {out_path}"
    )

    if write_latest and out_file is None:
        created = _write_latest_aliases(
            out_path, target_dir, wbs=wbs, mode=latest_mode
        )
        if created:
            joined = ", ".join(str(p) for p in created)
            log.info(
                f"[orchestrator.review_latest] Updated latest aliases: {joined}"
            )

    return out_path


def _apply_cli_overrides(args: argparse.Namespace) -> None:
    global MAX_PROMPT_CHARS, MAX_TOKENS, TEMPERATURE, REQUEST_TIMEOUT
    global RUN_GLOB, RUN_RECURSIVE, RUN_EXCLUDE_RE, _RUN_EXCLUDE_RX
    global LATEST_BASENAME, WRITE_WBS_LATEST, USE_STUB
    global OPENAI_FALLBACK_MODELS, ANTHROPIC_FALLBACK_MODELS, LOG_LEVEL, OPENAI_SEED

    if args.max_prompt_chars is not None:
        MAX_PROMPT_CHARS = args.max_prompt_chars
    if args.max_tokens is not None:
        MAX_TOKENS = args.max_tokens
    if args.temperature is not None:
        TEMPERATURE = args.temperature
    if args.timeout is not None:
        REQUEST_TIMEOUT = args.timeout

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
        OPENAI_FALLBACK_MODELS = [
            m.strip() for m in args.openai_fallbacks.split(",") if m.strip()
        ]
    if args.anthropic_fallbacks is not None:
        ANTHROPIC_FALLBACK_MODELS = [
            m.strip() for m in args.anthropic_fallbacks.split(",") if m.strip()
        ]

    if args.log_level is not None:
        logging.getLogger().setLevel(args.log_level)
        log.setLevel(args.log_level)

    if getattr(args, "seed", None) is not None:
        try:
            OPENAI_SEED = int(args.seed)
        except Exception:
            OPENAI_SEED = None


def main():
    parser = argparse.ArgumentParser(
        description="Compile a dual review (assistant‑manager + primary‑decider) for the latest run."
    )
    # Input selection
    parser.add_argument(
        "--run-file",
        dest="run_file",
        default=None,
        help="Optional path to a specific run .md file (defaults to most recent in RUN_DIR).",
    )
    parser.add_argument(
        "--stdin",
        action="store_true",
        help="Read the run report markdown from STDIN instead of disk (useful for piping).",
    )

    # Output / aliasing
    parser.add_argument(
        "--out-dir",
        dest="out_dir",
        default=None,
        help="Override output directory (defaults to ORCHESTRATOR_REVIEW_OUT_DIR).",
    )
    parser.add_argument(
        "--out-file",
        dest="out_file",
        default=DEFAULT_OUT_FILE,
        help="Write to this exact path (disables latest-alias updates).",
    )
    parser.add_argument(
        "--print-only", action="store_true", help="Print merged review to stdout."
    )
    parser.add_argument(
        "--no-latest",
        action="store_true",
        help="Do not update latest aliases.",
    )
    parser.add_argument(
        "--latest-mode",
        choices=["copy", "symlink", "none"],
        default="copy",
        help="How to maintain latest aliases.",
    )
    parser.add_argument(
        "--latest-basename",
        dest="latest_basename",
        default=None,
        help="Basename for the stable alias.",
    )
    parser.add_argument(
        "--wbs-latest",
        dest="wbs_latest",
        action="store_true",
        help="Also write latest-<WBS>.md alias.",
    )
    parser.add_argument(
        "--no-wbs-latest",
        dest="wbs_latest",
        action="store_false",
        help="Do not write latest-<WBS>.md alias.",
    )
    parser.set_defaults(wbs_latest=None)

    # LLM/provider behavior
    parser.add_argument("--temperature", type=float, default=None)
    parser.add_argument(
        "--timeout", type=float, dest="timeout", default=None
    )
    parser.add_argument(
        "--max-tokens", type=int, dest="max_tokens", default=None
    )
    parser.add_argument(
        "--max-prompt-chars", type=int, dest="max_prompt_chars", default=None
    )
    parser.add_argument("--seed", type=int, dest="seed", default=None)
    parser.add_argument("--use-stub", action="store_true")

    # Run discovery behavior
    parser.add_argument("--run-glob", dest="run_glob", default=None)
    parser.add_argument(
        "--recursive", dest="recursive", action="store_true"
    )
    parser.add_argument(
        "--no-recursive", dest="recursive", action="store_false"
    )
    parser.set_defaults(recursive=None)
    parser.add_argument("--exclude-re", dest="exclude_re", default=None)

    # Model fallbacks
    parser.add_argument(
        "--openai-fallbacks",
        dest="openai_fallbacks",
        default=None,
        help="Comma-separated OpenAI fallbacks.",
    )
    parser.add_argument(
        "--anthropic-fallbacks",
        dest="anthropic_fallbacks",
        default=None,
        help="Comma-separated Anthropic fallbacks.",
    )

    # Logging
    parser.add_argument(
        "--log-level",
        dest="log_level",
        default=None,
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )

    # Provider overrides
    parser.add_argument(
        "--am-provider",
        dest="am_provider",
        default=os.getenv("ORCHESTRATOR_AM_PROVIDER"),
    )
    parser.add_argument(
        "--am-model",
        dest="am_model",
        default=os.getenv("ORCHESTRATOR_AM_MODEL"),
    )
    parser.add_argument(
        "--pd-provider",
        dest="pd_provider",
        default=os.getenv("ORCHESTRATOR_PD_PROVIDER"),
    )
    parser.add_argument(
        "--pd-model",
        dest="pd_model",
        default=os.getenv("ORCHESTRATOR_PD_MODEL"),
    )

    args = parser.parse_args()

    try:
        _apply_cli_overrides(args)

        plan_override: Optional[List[tuple]] = None
        if (
            args.am_provider
            and args.am_model
            and args.pd_provider
            and args.pd_model
        ):
            plan_override = [
                (_SimpleProvider(args.am_provider), args.am_model),
                (_SimpleProvider(args.pd_provider), args.pd_model),
            ]

        report_text = None
        if args.stdin:
            if sys.stdin is not None and not sys.stdin.isatty():
                report_text = sys.stdin.read()
            else:
                log.error(
                    "[orchestrator.review_latest] --stdin specified but no STDIN data was provided."
                )
                sys.exit(2)

        run(
            review_run_file=args.run_file,
            out_dir=args.out_dir,
            print_only=args.print_only,
            report_text=report_text,
            out_file=args.out_file,
            latest_mode=args.latest_mode,
            write_latest=not args.no_latest,
            plan_override=plan_override,
        )
    except Exception as e:
        log.error(f"[orchestrator.review_latest] Failed: {e}")
        raise


if __name__ == "__main__":
    main()
