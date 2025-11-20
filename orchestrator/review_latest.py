from __future__ import annotations
import os
import re
import time
from pathlib import Path
from typing import List, Tuple

from .model_router import ModelRouter
from .providers.base import _stub_reply, LLMResponse

RUN_DIR = Path("docs/runs")
OUT_DIR = Path("docs/orchestrator/reviews")
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADER = "# Orchestrator Review\n"

ASSISTANT_MANAGER_SYSTEM = (
    "You are the assistant manager reviewer. Your job is to critically review the agent run report, "
    "surface risks, missing deliverables, and propose concrete follow-up tasks the orchestrator should queue."
)

PRIMARY_DECIDER_SYSTEM = (
    "You are the orchestrator's primary reviewer/decider. Consider the assistant-manager review, "
    "produce the final review with accept/reject decisions and a prioritized set of next actions for the orchestrator."
)

def _latest_run_file() -> Path:
    md_files = sorted(RUN_DIR.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not md_files:
        raise FileNotFoundError(f"No run reports found in {RUN_DIR}")
    return md_files[0]

def _call_provider(provider, model: str, system: str, prompt: str) -> LLMResponse:
    """Best-effort call; falls back to stub if keys/libs not present or call fails."""
    start = time.time()
    name = getattr(provider, "name", str(provider))
    use_stub = os.getenv("ORCHESTRATOR_LLM_STUB", "0") == "1"
    text, raw, tokens = None, None, None

    if not use_stub:
        try:
            if name == "openai":
                # OpenAI
                api_key = os.getenv("OPENAI_API_KEY")
                if not api_key:
                    raise RuntimeError("Missing OPENAI_API_KEY")
                try:
                    import openai
                    client = openai.OpenAI(api_key=api_key)
                except Exception:
                    # Back-compat for older SDKs
                    import openai  # type: ignore
                    openai.api_key = api_key
                    client = openai  # type: ignore

                try:
                    resp = client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system},
                            {"role": "user", "content": prompt},
                        ],
                        temperature=0.2,
                    )
                    # New SDK
                    choice = resp.choices[0]
                    text = getattr(choice.message, "content", None) or getattr(choice, "text", None)
                    raw = resp.model_dump() if hasattr(resp, "model_dump") else resp
                    tokens = getattr(resp, "usage", None)
                    tokens = getattr(tokens, "total_tokens", None) if tokens else None
                except AttributeError:
                    # Older SDK shape
                    resp = client.ChatCompletion.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system},
                            {"role": "user", "content": prompt},
                        ],
                        temperature=0.2,
                    )
                    text = resp["choices"][0]["message"]["content"]
                    raw = resp
                    tokens = resp.get("usage", {}).get("total_tokens")

            elif name == "anthropic":
                # Anthropic
                api_key = os.getenv("ANTHROPIC_API_KEY")
                if not api_key:
                    raise RuntimeError("Missing ANTHROPIC_API_KEY")
                import anthropic
                client = anthropic.Anthropic(api_key=api_key)
                msg = client.messages.create(
                    model=model,
                    system=PRIMARY_DECIDER_SYSTEM if "decid" in system.lower() else system,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=1200,
                    temperature=0.2,
                )
                # msg.content is a list of blocks
                try:
                    text = "".join(
                        blk.text for blk in msg.content if getattr(blk, "type", "") == "text"
                    )
                except Exception:
                    text = str(msg.content)
                raw = msg.to_dict() if hasattr(msg, "to_dict") else msg
                if hasattr(msg, "usage"):
                    try:
                        tokens = msg.usage.input_tokens + msg.usage.output_tokens
                    except Exception:
                        tokens = None
        except Exception as e:
            text = f"{_stub_reply(name, prompt)} (fallback: {e.__class__.__name__})"

    if text is None:
        text = _stub_reply(name, prompt)

    latency_ms = int((time.time() - start) * 1000)
    return LLMResponse(text=text, model=model, tokens=tokens, raw=raw, provider=name, latency_ms=latency_ms)

def compile_dual_review(report_md: str, router: ModelRouter) -> str:
    """Run assistant‑manager then primary‑decider and merge into one markdown document."""
    am_prompt = (
        "Review the following agent run report. Identify concrete risks, missing deliverables, "
        "and propose actionable follow-ups the orchestrator should queue.\n\n"
        f"{report_md}"
    )
    plan = router.providers_for_kind("review")

    # Assistant‑manager
    am_provider, am_model = plan[0]
    am = _call_provider(am_provider, am_model, ASSISTANT_MANAGER_SYSTEM, am_prompt)

    # Primary decider
    pd_provider, pd_model = plan[1] if len(plan) > 1 else plan[0]
    pd_prompt = (
        f"{am.text}\n\nNow decide: accept or reject the work, and output a prioritized list of next actions "
        "for the orchestrator with owners and due dates when possible."
    )
    pd = _call_provider(pd_provider, pd_model, PRIMARY_DECIDER_SYSTEM, pd_prompt)

    merged = [
        HEADER,
        f"- Assistant‑manager: **{am.provider}/{am.model}** ({am.latency_ms} ms)",
        f"- Primary‑decider: **{pd.provider}/{pd.model}** ({pd.latency_ms} ms)",
        "\n## Assistant‑Manager Review\n",
        am.text.strip(),
        "\n## Final Orchestrator Decision\n",
        pd.text.strip(),
        "",
    ]
    return "\n".join(merged)

def main():
    latest = _latest_run_file()
    print(f"[orchestrator.review_latest] Found latest run report: {latest}")
    print("[orchestrator.review_latest] Using providers per policy (kind=review) ...")
    router = ModelRouter()
    report_md = latest.read_text(encoding="utf-8")
    merged = compile_dual_review(report_md, router)

    # Derive WBS tag from filename if present
    m = re.search(r"(WBS-\d+)", latest.name)
    wbs = m.group(1) if m else "RUN"
    ts = time.strftime("%Y%m%d-%H%M%SZ", time.gmtime())
    out_path = OUT_DIR / f"orchestrator-review-{wbs}-{ts}.md"
    out_path.write_text(merged, encoding="utf-8")
    print(f"[orchestrator.review_latest] Wrote orchestrator review to: {out_path}")

if __name__ == "__main__":
    main()
