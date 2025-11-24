from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from .llm_client import LLMClient, LLMConfig
from . import blueprints


# ----------------------------
# Root resolution (single source)
# ----------------------------
def resolve_root(explicit: Optional[str]) -> Path:
    """
    Determine the repo root in this priority:
    1) --root argument
    2) RASTUP_REPO_ROOT env var
    3) the package parent (…/orchestrator/..)
    """
    if explicit:
        return Path(explicit).resolve()
    env_root = os.getenv("RASTUP_REPO_ROOT")
    if env_root:
        return Path(env_root).resolve()
    return Path(__file__).resolve().parent.parent


# ----------------------------
# Default config
# ----------------------------
def _default_config(repo_root: Path) -> Dict[str, Any]:
    return {
        "local_root_path": str(repo_root),
        "blueprints": {
            "non_tech": "ProjectPlans/Combined_Master_PLAIN_Non_Tech_001.docx",
            "tech": "ProjectPlans/TechnicalDevelopmentPlan.odt",
        },
        "models": {
            # LLM the *orchestrator* uses to reason/plan/summarise (OpenAI)
            "openai_model": "gpt-4o-mini",
            "embedding_model": "text-embedding-3-large",
            # Optional: let orchestrator call Anthropic for secondary review
            "anthropic_model": None,
        },
        "cursor": {
            "cli_command": "cursor-agent",  # never the GUI launcher
            "project_root": str(repo_root),
            # The orchestrator will *choose* actual per-run models; these are hard fallbacks:
            "default_model": "gpt-5",
            "agents": {
                "AGENT-1": {"role": "Bootstrap & DevOps", "model": "gpt-5-codex"},
                "AGENT-2": {"role": "Backend & Services", "model": "gpt-5-codex"},
                "AGENT-3": {
                    "role": "Frontend & Developer Experience",
                    "model": "gpt-5-codex",
                },
                "AGENT-4": {
                    "role": "QA / Security / Docs / Release",
                    "model": "claude-4.5-sonnet",
                },
            },
        },
    }


# ----------------------------
# FS layout
# ----------------------------
def ensure_basic_layout(repo_root: Path) -> None:
    (repo_root / "ops" / "locks").mkdir(parents=True, exist_ok=True)
    (repo_root / "ops" / "tasks").mkdir(parents=True, exist_ok=True)
    (repo_root / "docs" / "runs").mkdir(parents=True, exist_ok=True)
    (repo_root / "docs" / "orchestrator" / "from-agents").mkdir(
        parents=True, exist_ok=True
    )
    (repo_root / "docs" / "blueprints").mkdir(parents=True, exist_ok=True)

    config_path = repo_root / "ops" / "config.yaml"
    if not config_path.exists():
        cfg = _default_config(repo_root)
        config_path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
        print(f"[init] Wrote default config to {config_path}")
    else:
        print(f"[init] Config already exists at {config_path}")

    progress_path = repo_root / "docs" / "PROGRESS.md"
    if not progress_path.exists():
        progress_path.write_text(
            "# Project Progress\n\n"
            f"- Status: initialised\n"
            f"- Created: {datetime.now(timezone.utc).isoformat().replace('+00:00','Z')}\n\n"
            "## Notes\n\n"
            "- Orchestrator initialised. Blueprints not yet ingested.\n",
            encoding="utf-8",
        )
        print(f"[init] Wrote PROGRESS.md to {progress_path}")
    else:
        print(f"[init] PROGRESS.md already exists at {progress_path}")

    queue_path = repo_root / "ops" / "queue.jsonl"
    if not queue_path.exists():
        queue_path.write_text("", encoding="utf-8")
        print(f"[init] Created empty queue at {queue_path}")
    else:
        print(f"[init] Queue already exists at {queue_path}")


def load_config(repo_root: Path) -> Dict[str, Any]:
    config_path = repo_root / "ops" / "config.yaml"
    if not config_path.exists():
        raise SystemExit(
            "ops/config.yaml not found. Run `python -m orchestrator.cli init --root <repo>` first."
        )
    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8"))

    # 🔧 Auto-patch old configs that still use the GUI 'cursor' launcher
    cursor_cfg = cfg.get("cursor") or {}
    cli_cmd = cursor_cfg.get("cli_command")
    if cli_cmd == "cursor":
        cursor_cfg["cli_command"] = "cursor-agent"
        cfg["cursor"] = cursor_cfg
        config_path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
        print(
            "[config] Updated cursor.cli_command from 'cursor' to 'cursor-agent' in "
            f"{config_path}"
        )

    return cfg


def make_llm(config: Dict[str, Any]) -> LLMClient:
    models = config["models"]
    cfg = LLMConfig(
        openai_model=models.get("openai_model", "gpt-4o-mini"),
        embedding_model=models.get("embedding_model", "text-embedding-3-large"),
        anthropic_model=models.get("anthropic_model"),
    )
    try:
        return LLMClient(cfg)
    except Exception as e:
        print(
            f"[llm] WARN: failed to init SDKs cleanly: {e}. Some subcommands may still run."
        )
        return LLMClient(cfg)  # let it raise later if actually used


# ----------------------------
# Helpers
# ----------------------------
def _extract_json_from_text(raw: str) -> str:
    """
    Best-effort: given a model string that *should* contain JSON, pull out the JSON object.

    Handles:
    - Plain JSON
    - ```json ... ``` fenced blocks
    - Extra prose before/after the JSON by slicing between first '{' and last '}'.
    """
    if not isinstance(raw, str):
        return raw  # let json.loads complain

    text = raw.strip()
    if not text:
        return text

    # Fenced block: ```json\n{...}\n```
    if text.startswith("```"):
        fence = "```"
        first = 0
        second = text.find(fence, first + len(fence))
        if second != -1:
            inner = text[first + len(fence) : second]
            inner = inner.lstrip()
            if inner.lower().startswith("json"):
                inner = inner[4:].lstrip()
            return inner.strip()

    # If it's already valid JSON, we're done.
    try:
        json.loads(text)
        return text
    except Exception:
        pass

    # Fallback: slice from first '{' to last '}'.
    first = text.find("{")
    last = text.rfind("}")
    if 0 <= first < last:
        candidate = text[first : last + 1].strip()
        return candidate

    return text


# ----------------------------
# Commands
# ----------------------------
def cmd_init(args: argparse.Namespace) -> None:
    repo_root = resolve_root(args.root)
    ensure_basic_layout(repo_root)


def cmd_ingest_blueprints(args: argparse.Namespace) -> None:
    repo_root = resolve_root(args.root)
    cfg = load_config(repo_root)
    llm = make_llm(cfg)
    bp_cfg = cfg["blueprints"]

    non_tech_src = repo_root / bp_cfg["non_tech"]
    tech_src = repo_root / bp_cfg["tech"]

    if not non_tech_src.exists():
        raise SystemExit(f"Non-technical blueprint not found: {non_tech_src}")
    if not tech_src.exists():
        raise SystemExit(f"Technical blueprint not found: {tech_src}")

    index_path = blueprints.build_blueprint_index(
        repo_root=repo_root,
        non_tech_src=non_tech_src,
        tech_src=tech_src,
        llm=llm,
    )
    print(f"[ingest-blueprints] Blueprint index ready at {index_path}")


def cmd_verify_blueprints(args: argparse.Namespace) -> None:
    repo_root = resolve_root(args.root)
    try:
        meta, paths = blueprints.load_blueprint_index(repo_root)
    except FileNotFoundError:
        raise SystemExit(
            f"[verify-blueprints] Missing index at "
            f"{repo_root/'docs/blueprints/blueprint_index.json'}"
        )
    nt = sum(1 for r in meta if (r.get("doc_type") or "").startswith("non"))
    tt = sum(1 for r in meta if (r.get("doc_type") or "").startswith("tech"))
    print(f"[verify-blueprints] OK: {len(meta)} chunks ({nt} non-tech, {tt} tech).")
    print(f"[verify-blueprints] Paths: {paths}")


def cmd_plan(args: argparse.Namespace) -> None:
    repo_root = resolve_root(args.root)
    cfg = load_config(repo_root)
    llm = make_llm(cfg)
    meta, _ = blueprints.load_blueprint_index(repo_root)

    # Compose summaries for planning prompt
    lines: List[str] = []
    for row in meta:
        summary = row.get("summary") or ""
        lines.append(f"{row['id']} ({row['doc_type']}): {summary}")
    summaries_block = "\n".join(lines)

    system = (
        "You are a senior engineering program manager for a large multi-month build. "
        "You are given technical and non-technical blueprint fragments. "
        "Construct a Work Breakdown Structure (WBS) and an execution queue for four Cursor agents:\n"
        "- AGENT-1: Bootstrap & DevOps\n"
        "- AGENT-2: Backend & Services\n"
        "- AGENT-3: Frontend & Developer Experience\n"
        "- AGENT-4: QA, Security, Docs, Release\n\n"
        "WBS must reflect implementation order, NOT document order.\n"
        "You MUST produce between 20 and 40 tasks; fewer than 20 tasks is too coarse, more than 40 is unnecessary.\n\n"
        "Output pure JSON only (no markdown, no commentary):\n"
        "{ \"tasks\": [ { \"id\":\"WBS-001\", \"title\":\"…\", \"description\":\"…\", "
        "\"agent\":\"AGENT-1|AGENT-2|AGENT-3|AGENT-4\", \"depends_on\":[\"WBS-000\"], "
        "\"blueprint_ids\":[\"NT-0001\",\"TD-0007\"], \"phase\":\"Bootstrap|Backend|Frontend|QA|Ops|Docs|Other\", "
        "\"acceptance_criteria\":[\"…\"] } ] }"
    )

    user = (
        "You will receive a list of blueprint chunks: `ID (doc_type): summary`.\n"
        "Use these to reconstruct the big picture and propose a sane build order.\n\n"
        "You MUST include tasks not only for feature and infra work, but also for:\n"
        "- docs/ARCHITECTURE.md, docs/adr/ADR-*.md, docs/runbooks/*.md\n"
        "- docs/ACCESS_ENVELOPE.md, docs/TEST_POLICY.md, docs/RISKS.md\n"
        "- docs/FILE_INDEX.md (or CODEMAP.json)\n"
        "- orchestrator improvements (idempotence/state, token-discipline, agent prompts, meta-QA, usage tracking)\n\n"
        "For each task, `blueprint_ids` MUST be a small, relevant subset (roughly 3–25 IDs) "
        "and MUST NOT just list all chunk IDs.\n"
        "Assign agents sensibly (infra->backend->frontend->E2E QA; docs as work matures).\n\n"
        "Blueprint chunk summaries:\n\n"
        f"{summaries_block}"
    )

    raw = llm.chat_openai(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
    )

    cleaned = _extract_json_from_text(raw)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        print("[plan] Failed to parse JSON from model output. Raw output:")
        print(raw)
        raise

    tasks = data.get("tasks", [])
    if not tasks:
        raise SystemExit("[plan] Model returned no tasks.")

    wbs_path = repo_root / "ops" / "wbs.json"
    wbs_path.write_text(
        json.dumps(tasks, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"[plan] Wrote WBS with {len(tasks)} tasks to {wbs_path}")

    queue_path = repo_root / "ops" / "queue.jsonl"
    with queue_path.open("w", encoding="utf-8") as f:
        for i, t in enumerate(tasks):
            queue_item = {
                "task_id": t["id"],
                "agent": t["agent"],
                "status": "todo",
                "created_at": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
                "blueprint_ids": t.get("blueprint_ids", []),
                "title": t.get("title", ""),
                "phase": t.get("phase", ""),
                "depends_on": t.get("depends_on", []),
                "acceptance_criteria": t.get("acceptance_criteria", []),
                "priority": i + 1,
            }
            f.write(json.dumps(queue_item, ensure_ascii=False) + "\n")
    print(f"[plan] Wrote queue items to {queue_path}")

    # Human list
    todo_path = repo_root / "docs" / "TODO_MASTER.md"
    items: List[Dict[str, Any]] = []
    with queue_path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                items.append(json.loads(line))

    items.sort(key=lambda q: (q.get("phase", ""), q["agent"], q["priority"]))
    lines_out: List[str] = [
        "# Orchestrator To-Do List\n",
        "_Generated from ops/queue.jsonl. Do not edit manually._\n",
    ]
    current_phase: Optional[str] = None
    for item in items:
        if item["status"] != "todo":
            continue
        phase = item.get("phase") or "Unspecified"
        if phase != current_phase:
            lines_out.append(f"\n## Phase: {phase}\n")
            current_phase = phase
        lines_out.append(
            f"- [ ] `{item['task_id']}` **({item['agent']})** - "
            f"{item.get('title','') or '(no title)'} "
            f"(priority {item['priority']})"
        )

    todo_path.write_text("\n".join(lines_out), encoding="utf-8")
    print(f"[plan] Wrote human-readable TODO list to {todo_path}")


def build_task_file(
    repo_root: Path,
    wbs_task: Dict[str, Any],
    agent_name: str,
    llm: LLMClient,
) -> Path:
    meta, _ = blueprints.load_blueprint_index(repo_root)
    meta_by_id = {row["id"]: row for row in meta}

    blueprint_ids = wbs_task.get("blueprint_ids", [])
    blueprint_chunks: List[str] = []
    for bid in blueprint_ids:
        row = meta_by_id.get(bid)
        if not row:
            continue
        sub = "non-tech" if row["doc_type"] == "non-tech" else "tech"
        bp_path = repo_root / "docs" / "blueprints" / sub / f"{row['id']}.md"
        if bp_path.exists():
            blueprint_chunks.append(
                f"### {row['id']} ({sub})\n\n" + bp_path.read_text(encoding="utf-8")
            )
        else:
            blueprint_chunks.append(
                f"### {row['id']} ({sub})\n\n" + (row.get("text") or "")
            )

    bp_section = (
        "\n\n".join(blueprint_chunks)
        if blueprint_chunks
        else "_No linked blueprint chunks._"
    )

    content = (
        f"# Task for {agent_name}: {wbs_task['id']} — {wbs_task.get('title','')}\n\n"
        "You are a Cursor CLI agent working under a central Orchestrator.\n\n"
        "## WBS Task\n\n"
        f"- ID: {wbs_task['id']}\n"
        f"- Title: {wbs_task.get('title','')}\n"
        f"- Phase: {wbs_task.get('phase','')}\n"
        f"- Agent: {agent_name}\n"
        f"- Depends on: {', '.join(wbs_task.get('depends_on', [])) or '(none)'}\n"
        f"- Blueprint IDs: {', '.join(blueprint_ids) or '(none)'}\n\n"
        "### Description\n\n"
        f"{wbs_task.get('description','')}\n\n"
        "### Acceptance Criteria\n\n"
    )
    for ac in wbs_task.get("acceptance_criteria", []):
        content += f"- {ac}\n"
    if not wbs_task.get("acceptance_criteria"):
        content += "- (No explicit acceptance criteria provided.)\n"

    content += (
        "\n\n## Relevant Blueprint Chunks\n\n"
        f"{bp_section}\n\n"
        "## Pre-Run Ritual (HARD)\n\n"
        "- [ ] Read your last run report.\n"
        "- [ ] Read any related run reports for the same WBS or feature.\n"
        "- [ ] Summarise Plan vs Done vs Pending before writing new code.\n\n"
        "## Locking & Access (HARD)\n\n"
        f"- Acquire your lock file at `ops/locks/{agent_name}.lock` before modifying files.\n"
        "- Declare your scope_paths[] in your run report.\n"
        "- If you detect overlapping scopes or foreign changes, STOP and hand back to the Orchestrator.\n\n"
        "## Required Run Report Content (HARD)\n\n"
        "- Context Snapshot (WBS IDs, blueprint IDs, assumptions).\n"
        "- What Was Done vs Planned.\n"
        "- How It Was Done (architecture/implementation narrative).\n"
        "- Testing (commands, results, coverage, security scans) + 'Testing Proof' paragraph.\n"
        "- Issues & Problems (with root causes where possible).\n"
        "- Locations / Touch Map (files created/modified/removed, migrations, databases touched).\n"
        "- Suggestions for Next Agents.\n"
        "- Progress & Checklist.\n\n"
        "## Orchestrator Attach Pack (HARD)\n\n"
        "- Place under `docs/orchestrator/from-agents/"
        f"{agent_name}/run-<timestamp>-attach.zip`.\n"
        "- Include: run report, diff summary, CI/test artifacts, performance/security results,\n"
        "  and a manifest.json (agent, run_id, wbs_ids, blueprint_ids, status).\n\n"
        "## Testing (HARD)\n\n"
        "- Define a test plan before coding.\n"
        "- Implement unit/integration/E2E tests where appropriate.\n"
        "- Record all test commands and results in the run report.\n"
        "- If you cannot implement or run tests, mark the task partial and propose follow-up WBS items.\n\n"
        "## Implementation Notes\n\n"
        "(Use this space during your run.)\n\n"
        "## Issues & Risks\n\n"
        "(Document any issues, risks, or TODOs you discover.)\n\n"
        "## Suggestions for Next Agents\n\n"
        "(Document any guidance for follow-up work.)\n"
    )

    task_root = repo_root / "ops" / "tasks" / agent_name
    task_root.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
    task_path = task_root / f"{wbs_task['id']}-{ts}.md"
    task_path.write_text(content, encoding="utf-8")
    return task_path


def _decide_agent_model(
    repo_root: Path,
    agent_name: str,
    wbs_task: Dict[str, Any],
    cfg: Dict[str, Any],
    llm: LLMClient,
) -> Tuple[str, bool, str]:
    """
    Orchestrator chooses the Cursor model + MAX flag and logs the decision.
    Returns (model, max_flag, reason).
    """
    defaults = {
        "AGENT-1": "gpt-5-codex",
        "AGENT-2": "gpt-5-codex",
        "AGENT-3": "gpt-5-codex",
        "AGENT-4": "claude-4.5-sonnet",
    }
    suggested = (
        defaults.get(agent_name)
        or cfg.get("cursor", {}).get("default_model")
        or "gpt-5"
    )

    # Ask OpenAI to pick (you can change this to Anthropic if desired).
    prompt = json.dumps(
        {
            "agent": agent_name,
            "task": {
                "id": wbs_task.get("id"),
                "title": wbs_task.get("title"),
                "phase": wbs_task.get("phase"),
                "desc": (wbs_task.get("description") or "")[:1500],
            },
            "available_models": [
                "gpt-5",
                "gpt-5-codex",
                "gpt-4o",
                "gpt-4o-mini",
                "claude-4.5-sonnet",
                "claude-4.5-haiku",
                "composer-1",
            ],
            "instruction": "Pick exactly one `model` from available_models and a boolean `max`. "
            "Return JSON only: {\"model\":\"...\",\"max\":true|false,\"reason\":\"...\"}.",
        },
        ensure_ascii=False,
    )

    try:
        raw = llm.chat_openai(
            [
                {"role": "system", "content": "You are the orchestrator's model selector."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
        )
        data = json.loads(raw)
        model = str(data.get("model") or suggested)
        mx = bool(data.get("max") or False)
        reason = str(data.get("reason") or "heuristic")
    except Exception:
        model, mx, reason = suggested, False, "fallback"

    # Log the decision
    md_log = repo_root / "ops" / "model-decisions.jsonl"
    md_log.parent.mkdir(parents=True, exist_ok=True)
    md_log.open("a", encoding="utf-8").write(
        json.dumps(
            {
                "time": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
                "task_id": wbs_task.get("id"),
                "agent": agent_name,
                "model": model,
                "max": mx,
                "reason": reason,
            },
            ensure_ascii=False,
        )
        + "\n"
    )
    return model, mx, reason


def cmd_run_next(args: argparse.Namespace) -> None:
    repo_root = resolve_root(args.root)
    cfg = load_config(repo_root)
    llm = make_llm(cfg)

    queue_path = repo_root / "ops" / "queue.jsonl"
    lines = (
        [
            l
            for l in queue_path.read_text(encoding="utf-8").splitlines()
            if l.strip()
        ]
        if queue_path.exists()
        else []
    )
    if not lines:
        print("[run-next] Queue is empty.")
        return

    items = [json.loads(l) for l in lines]
    next_item: Optional[Dict[str, Any]] = None
    remaining: List[Dict[str, Any]] = []
    status_by_id = {it["task_id"]: it["status"] for it in items}

    for it in items:
        if it.get("status") != "todo":
            remaining.append(it)
            continue
        deps = it.get("depends_on", [])
        if all(status_by_id.get(d) == "done" for d in deps):
            if not next_item:
                next_item = it
                it["status"] = "in_progress"
        remaining.append(it)

    if not next_item:
        print("[run-next] No unblocked todo items found.")
        return

    with queue_path.open("w", encoding="utf-8") as f:
        for it in remaining:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")

    wbs_path = repo_root / "ops" / "wbs.json"
    wbs = json.loads(wbs_path.read_text(encoding="utf-8"))
    wbs_by_id = {t["id"]: t for t in wbs}
    wbs_task = wbs_by_id[next_item["task_id"]]
    agent_name = next_item["agent"]

    task_file = build_task_file(repo_root, wbs_task, agent_name, llm)
    print(f"[run-next] Created task file for {agent_name}: {task_file}")

    # Decide Cursor model (orchestrator decides; Cursor executes)
    model, max_flag, reason = _decide_agent_model(
        repo_root, agent_name, wbs_task, cfg, llm
    )

    cursor_cfg = cfg.get("cursor", {})
    cli_cmd = cursor_cfg.get("cli_command") or "cursor-agent"
    if cli_cmd == "cursor":
        cli_cmd = "cursor-agent"  # guardrail

    prompt = (
        f"You are {agent_name}, a Cursor CLI agent with role: "
        f"{(cursor_cfg.get('agents') or {}).get(agent_name, {}).get('role','(unspecified)')}.\n"
        f"Repository root on disk: {repo_root}\n"
        f"Task file path: {task_file}\n\n"
        "Instructions:\n"
        "1. Start by reading the task file at the given path and follow the instructions inside it.\n"
        "2. Treat the task file as the source of truth for this assignment, including run-report and attach-pack requirements.\n"
        "3. Work directly in the repository at the given root path.\n"
        "4. When finished, ensure all required tests and checks in the task file are run and documented.\n"
    )
    cmd = [cli_cmd, "-p", prompt, "--model", model, "--force"]
    # NOTE: `cursor-agent` currently errors on `--max`, so we *don't* pass it.
    # We still log the `max_flag` decision for observability, but execution ignores it.

    print(
        "[run-next] About to run Cursor Agent CLI (non-interactive): "
        f"{cli_cmd} -p \"[task instructions]\" --model {model} --force"
    )
    env = os.environ.copy()
    # Let the Cursor CLI pick up CURSOR_API_KEY from env if present
    try:
        subprocess.run(cmd, cwd=str(repo_root), env=env, check=False)
    except FileNotFoundError:
        print(
            "[run-next] ERROR: `cursor-agent` CLI not found on PATH.\n"
            "Install it from https://cursor.com/docs/cli/overview and ensure it runs (e.g. `cursor-agent --version`)."
        )


def cmd_status(args: argparse.Namespace) -> None:
    repo_root = resolve_root(args.root)
    queue_path = repo_root / "ops" / "queue.jsonl"
    if not queue_path.exists():
        print("Queue not found; run init and plan.")
        return
    lines = [
        l
        for l in queue_path.read_text(encoding="utf-8").splitlines()
        if l.strip()
    ]
    if not lines:
        print("Queue is empty.")
        return
    items = [json.loads(l) for l in lines]
    counts: Dict[str, int] = {}
    for it in items:
        counts[it["status"]] = counts.get(it["status"], 0) + 1
    print("Queue status:")
    for k, v in counts.items():
        print(f"- {k}: {v}")


def cmd_index_files(args: argparse.Namespace) -> None:
    repo_root = resolve_root(args.root)
    cfg = load_config(repo_root)
    llm = make_llm(cfg)

    root = repo_root
    ignore_dirs = {".git", ".venv", "node_modules", ".cursor", "__pycache__"}
    entries: List[Dict[str, Any]] = []

    max_files = getattr(args, "max_files", None)
    seen = 0

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in ignore_dirs for part in rel.parts):
            continue

        stat = path.stat()
        size = stat.st_size
        ext = path.suffix.lower()

        entry: Dict[str, Any] = {
            "path": str(rel).replace("\\", "/"),
            "size_bytes": size,
            "ext": ext,
        }

        description = ""
        if ext in {".py", ".ts", ".tsx", ".js", ".md", ".json", ".yaml", ".yml"} and size < 200_000:
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
                snippet = text[:4000]
                description = llm.chat_openai(
                    messages=[
                        {"role": "system", "content": "You are documenting a codebase."},
                        {
                            "role": "user",
                            "content": (
                                "Summarise what this file does in 1–3 short sentences, "
                                "including its main responsibilities and how it fits into a larger system.\n\n"
                                f"FILE PATH: {rel}\n\n"
                                f"CONTENT SNIPPET:\n{snippet}"
                            ),
                        },
                    ]
                ).strip()
            except Exception as e:
                description = f"(Failed to summarise: {e})"

        entry["description"] = description
        entries.append(entry)
        seen += 1
        if max_files is not None and seen >= max_files:
            break

    docs_root = repo_root / "docs"
    docs_root.mkdir(parents=True, exist_ok=True)

    json_path = docs_root / "FILE_INDEX.json"
    json_path.write_text(
        json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    md_path = docs_root / "FILE_INDEX.md"
    lines = ["# File Index\n", "_Generated; do not edit manually._\n"]
    for e in entries:
        lines.append(f"- `{e['path']}` — {e['description'] or '(no summary)'}")
    md_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"[index-files] Wrote {len(entries)} entries to {json_path} and {md_path}")


# ----------------------------
# CLI
# ----------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="RastUp Orchestrator CLI")
    parser.add_argument(
        "--root",
        help="Project root (falls back to RASTUP_REPO_ROOT env or package parent).",
        default=None,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="Initialise ops/ and docs/ structure.")
    sub.add_parser(
        "ingest-blueprints", help="Convert + index the two big project plans."
    )
    sub.add_parser(
        "verify-blueprints",
        help="Verify the blueprint index exists and show counts.",
    )
    sub.add_parser(
        "plan",
        help="Generate WBS, queue.jsonl, and TODO_MASTER.md from blueprint index.",
    )
    sub.add_parser(
        "run-next", help="Pop next queue item and dispatch to Cursor agent."
    )
    sub.add_parser("status", help="Print high-level queue status.")

    index_parser = sub.add_parser(
        "index-files", help="Build the file/directory map from the repo."
    )
    index_parser.add_argument(
        "--max-files",
        type=int,
        default=None,
        help="Optional limit on number of files to summarise (for faster/cheaper runs).",
    )

    args = parser.parse_args()

    if args.command == "init":
        cmd_init(args)
    elif args.command == "ingest-blueprints":
        cmd_ingest_blueprints(args)
    elif args.command == "verify-blueprints":
        cmd_verify_blueprints(args)
    elif args.command == "plan":
        cmd_plan(args)
    elif args.command == "run-next":
        cmd_run_next(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "index-files":
        cmd_index_files(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
