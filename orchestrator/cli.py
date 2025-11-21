from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import datetime, UTC
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from .llm_client import LLMClient, LLMConfig
from . import blueprints

# ------------------------------------------------------------------------------
# Root resolution
# ------------------------------------------------------------------------------

_REPO_ROOT_DEFAULT = Path(__file__).resolve().parent.parent

def resolve_repo_root(cli_root: Optional[str]) -> Path:
    """
    Resolve a repository root with clear precedence:
      1) --root CLI flag
      2) RASTUP_REPO_ROOT environment variable
      3) current working directory (if it looks like a repo)
      4) package default (two levels up from this file)
    """
    candidates: List[Optional[Path]] = []
    if cli_root:
        candidates.append(Path(cli_root))
    env_root = os.getenv("RASTUP_REPO_ROOT")
    if env_root:
        candidates.append(Path(env_root))
    candidates.append(Path.cwd())
    candidates.append(_REPO_ROOT_DEFAULT)

    for p in candidates:
        if not p:
            continue
        # Prefer a path that clearly looks like the project root
        if (p / "orchestrator").exists():
            return p
        if (p / ".git").exists():
            return p
        # Still valid as last resort if user gave a path without markers
        if p.exists():
            return p
    return _REPO_ROOT_DEFAULT


# ------------------------------------------------------------------------------
# Defaults
# ------------------------------------------------------------------------------

def _default_config(repo_root: Path) -> Dict[str, Any]:
    return {
        "local_root_path": str(repo_root),
        "blueprints": {
            "non_tech": "ProjectPlans/Combined_Master_PLAIN_Non_Tech_001.docx",
            "tech": "ProjectPlans/TechnicalDevelopmentPlan.odt",
        },
        "models": {
            # Orchestrator’s own LLMs (OpenAI primary; Anthropic optional)
            "openai_model": "gpt-4.1-mini",
            "embedding_model": "text-embedding-3-large",
            "anthropic_model": None,
        },
        "cursor": {
            # Always the CLI, never the desktop launcher
            "cli_command": "cursor-agent",
            "project_root": str(repo_root),
            # The orchestrator will override per task and log the decision
            "default_model": "gpt-5",
            "agents": {
                "AGENT-1": {"role": "Bootstrap & DevOps", "model": "gpt-5-codex"},
                "AGENT-2": {"role": "Backend & Services", "model": "gpt-5-codex"},
                "AGENT-3": {"role": "Frontend & Developer Experience", "model": "gpt-5-codex"},
                "AGENT-4": {"role": "QA / Security / Docs / Release", "model": "claude-4.5-sonnet"},
            },
        },
    }


# ------------------------------------------------------------------------------
# Filesystem layout + config
# ------------------------------------------------------------------------------

def ensure_basic_layout(repo_root: Path) -> None:
    (repo_root / "ops" / "locks").mkdir(parents=True, exist_ok=True)
    (repo_root / "ops" / "tasks").mkdir(parents=True, exist_ok=True)
    (repo_root / "docs" / "runs").mkdir(parents=True, exist_ok=True)
    (repo_root / "docs" / "orchestrator" / "from-agents").mkdir(parents=True, exist_ok=True)
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
            "- Status: initialised\n"
            f"- Created: {datetime.now(UTC).isoformat()}\n\n"
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
        raise SystemExit("ops/config.yaml not found. Run `python -m orchestrator.cli init --root <path>` first.")
    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8"))

    # 🔧 Auto-patch old configs that still use the GUI 'cursor' launcher
    cursor_cfg = cfg.get("cursor") or {}
    cli_cmd = cursor_cfg.get("cli_command")
    if cli_cmd == "cursor":
        cursor_cfg["cli_command"] = "cursor-agent"
        cfg["cursor"] = cursor_cfg
        config_path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
        print(f"[config] Updated cursor.cli_command from 'cursor' to 'cursor-agent' in {config_path}")

    return cfg


def make_llm(config: Dict[str, Any]) -> LLMClient:
    models = config["models"]
    cfg = LLMConfig(
        openai_model=models.get("openai_model", "gpt-4.1-mini"),
        embedding_model=models.get("embedding_model", "text-embedding-3-large"),
        anthropic_model=models.get("anthropic_model"),
    )
    return LLMClient(cfg)


# ------------------------------------------------------------------------------
# Commands
# ------------------------------------------------------------------------------

def cmd_init(args: argparse.Namespace) -> None:
    repo_root = resolve_repo_root(args.root)
    print(f"[root] Using repository root: {repo_root}")
    ensure_basic_layout(repo_root)


def cmd_ingest_blueprints(args: argparse.Namespace) -> None:
    repo_root = resolve_repo_root(args.root)
    print(f"[root] Using repository root: {repo_root}")
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


def cmd_plan(args: argparse.Namespace) -> None:
    repo_root = resolve_repo_root(args.root)
    print(f"[root] Using repository root: {repo_root}")
    cfg = load_config(repo_root)
    llm = make_llm(cfg)
    meta, _ = blueprints.load_blueprint_index(repo_root)

    lines: List[str] = []
    for row in meta:
        summary = row.get("summary") or ""
        lines.append(f"{row['id']} ({row['doc_type']}): {summary}")
    summaries_block = "\n".join(lines)

    system = (
        "You are a senior engineering program manager for a very large multi-month build. "
        "You are given technical and non-technical blueprint fragments. "
        "Your job is to construct a Work Breakdown Structure (WBS) and an execution queue for "
        "four Cursor agents:\n"
        "- AGENT-1: Bootstrap & DevOps\n"
        "- AGENT-2: Backend & Services\n"
        "- AGENT-3: Frontend & Developer Experience\n"
        "- AGENT-4: QA, Security, Docs, Release\n\n"
        "WBS must reflect implementation order, NOT document order.\n\n"
        "You MUST output pure JSON (no markdown, no comments) of the form:\n"
        "{\n"
        '  \"tasks\": [\n'
        "    {\n"
        '      \"id\": \"WBS-001\",\n'
        '      \"title\": \"short name\",\n'
        '      \"description\": \"1-3 paragraphs\",\n'
        '      \"agent\": \"AGENT-1|AGENT-2|AGENT-3|AGENT-4\",\n'
        '      \"depends_on\": [\"WBS-000\"],\n'
        '      \"blueprint_ids\": [\"NT-0001\", \"TD-0007\"],\n'
        '      \"phase\": \"Bootstrap|Backend|Frontend|QA|Ops|Docs|Other\",\n'
        '      \"acceptance_criteria\": [\"...\", \"...\"]\n'
        "    }\n"
        "  ]\n"
        "}\n"
    )

    user = (
        "You will receive a list of blueprint chunks: `ID (doc_type): summary`.\n"
        "Use these to reconstruct the big picture and propose a sane build order.\n\n"
        "You MUST include tasks not only for feature and infra work, but also for:\n"
        "- Creating and maintaining core docs:\n"
        "  - docs/ARCHITECTURE.md\n"
        "  - docs/adr/ADR-xxxx-*.md (architecture decision records)\n"
        "  - docs/runbooks/*.md (deploy, rollback, on-call, troubleshooting)\n"
        "  - docs/ACCESS_ENVELOPE.md (God-mode-with-guardrails access policy)\n"
        "  - docs/TEST_POLICY.md (zero-doubt testing policy)\n"
        "  - docs/RISKS.md (risk log)\n"
        "  - docs/FILE_INDEX.md or docs/CODEMAP.json (code/directory map)\n"
        "- Orchestrator improvements and meta-work:\n"
        "  - Idempotent tasks & resumable orchestrator runs (state.json, safe restart)\n"
        "  - Token discipline patterns (chunk+summarise+index, never load huge blobs)\n"
        "  - Per-agent prompt definitions in docs/agents/AGENT-*.md\n"
        "  - Recurring meta-QA tasks by AGENT-4 to audit run reports & queue quality\n"
        "  - Usage/cost tracking for LLM calls and CI runs\n\n"
        "For each WBS task you output:\n"
        "- Assign the most appropriate agent.\n"
        "- Attach the relevant blueprint_ids from the list.\n"
        "- Provide clear acceptance_criteria so Cursor agents can know when they are done.\n"
        "- Ensure dependencies respect reality.\n\n"
        "Now here are the blueprint chunk summaries:\n\n"
        f"{summaries_block}"
    )

    raw = llm.chat_openai(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
    )

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        print("[plan] Failed to parse JSON from model output. Raw output:")
        print(raw)
        raise

    tasks = data.get("tasks", [])
    if not tasks:
        raise SystemExit("[plan] Model returned no tasks.")

    wbs_path = repo_root / "ops" / "wbs.json"
    wbs_path.write_text(json.dumps(tasks, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[plan] Wrote WBS with {len(tasks)} tasks to {wbs_path}")

    queue_path = repo_root / "ops" / "queue.jsonl"
    with queue_path.open("w", encoding="utf-8") as f:
        for i, t in enumerate(tasks):
            queue_item = {
                "task_id": t["id"],
                "agent": t["agent"],
                "status": "todo",
                "created_at": datetime.now(UTC).isoformat(),
                "blueprint_ids": t.get("blueprint_ids", []),
                "title": t.get("title", ""),
                "phase": t.get("phase", ""),
                "depends_on": t.get("depends_on", []),
                "acceptance_criteria": t.get("acceptance_criteria", []),
                "priority": i + 1,
            }
            f.write(json.dumps(queue_item, ensure_ascii=False) + "\n")
    print(f"[plan] Wrote queue items to {queue_path}")

    # Human-readable TODO
    todo_path = repo_root / "docs" / "TODO_MASTER.md"
    queue_items: List[Dict[str, Any]] = []
    with queue_path.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            queue_items.append(json.loads(line))

    queue_items.sort(key=lambda q: (q.get("phase", ""), q["agent"], q["priority"]))

    lines_out: List[str] = [
        "# Orchestrator To-Do List\n",
        "_This file is generated from ops/queue.jsonl. Do not edit manually._\n",
    ]
    current_phase: Optional[str] = None
    for item in queue_items:
        if item["status"] != "todo":
            continue
        phase = item.get("phase") or "Unspecified"
        if phase != current_phase:
            lines_out.append(f"\n## Phase: {phase}\n")
            current_phase = phase
        lines_out.append(
            f"- [ ] `{item['task_id']}` **({item['agent']})** "
            f"- {item.get('title','') or '(no title)'} (priority {item['priority']})"
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
            blueprint_chunks.append(f"### {row['id']} ({sub})\n\n" + bp_path.read_text(encoding="utf-8"))
        else:
            blueprint_chunks.append(f"### {row['id']} ({sub})\n\n" + row.get("text", ""))

    bp_section = "\n\n".join(blueprint_chunks) if blueprint_chunks else "_No linked blueprint chunks._"

    content = (
        f"# Task for {agent_name}: {wbs_task['id']} — {wbs_task.get('title','')}\n\n"
        "You are a **Cursor CLI** agent running under a central Orchestrator.\n\n"
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
    ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%SZ")
    task_path = task_root / f"{wbs_task['id']}-{ts}.md"
    task_path.write_text(content, encoding="utf-8")
    return task_path


def _cursor_cli_exists(cmd: str) -> bool:
    exe = shutil.which(cmd)
    return exe is not None


def _select_agent_model(agent_name: str, cursor_cfg: Dict[str, Any], wbs_task: Dict[str, Any]) -> str:
    """
    Orchestrator-owned model policy with simple heuristics:
      - Use per-agent override if configured.
      - Else fallback to cursor.default_model.
      - Else pick a sensible default by agent role.
    """
    agent_cfg = (cursor_cfg.get("agents") or {}).get(agent_name, {})
    default_agent_models = {
        "AGENT-1": "gpt-5-codex",
        "AGENT-2": "gpt-5-codex",
        "AGENT-3": "gpt-5-codex",
        "AGENT-4": "claude-4.5-sonnet",
    }
    return (
        agent_cfg.get("model")
        or cursor_cfg.get("default_model")
        or default_agent_models.get(agent_name)
        or "gpt-5"
    )


def cmd_run_next(args: argparse.Namespace) -> None:
    repo_root = resolve_repo_root(args.root)
    print(f"[root] Using repository root: {repo_root}")

    cfg = load_config(repo_root)
    llm = make_llm(cfg)

    queue_path = repo_root / "ops" / "queue.jsonl"
    lines = [l for l in queue_path.read_text(encoding="utf-8").splitlines() if l.strip()]
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

    cursor_cfg = cfg.get("cursor", {})
    cli_cmd = cursor_cfg.get("cli_command") or "cursor-agent"
    if cli_cmd == "cursor":
        cli_cmd = "cursor-agent"  # never the desktop app

    if not _cursor_cli_exists(cli_cmd):
        print(
            "[run-next] ERROR: `cursor-agent` CLI not found on PATH.\n"
            "Install it: https://cursor.com/docs/cli/overview and ensure `cursor-agent --version` works."
        )
        return

    # Orchestrator chooses model and records the decision
    model = _select_agent_model(agent_name, cursor_cfg, wbs_task)
    model_log = {
        "timestamp": datetime.now(UTC).isoformat(),
        "task_id": wbs_task["id"],
        "agent": agent_name,
        "model": model,
        "reason": "orchestrator policy (agent mapping + defaults)",
    }
    (repo_root / "ops").mkdir(parents=True, exist_ok=True)
    with (repo_root / "ops" / "model-decisions.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(model_log, ensure_ascii=False) + "\n")

    # Compose a single non-interactive prompt that points the agent at the task file
    prompt = (
        f"You are {agent_name}, a **Cursor CLI** agent with role: "
        f"{(cursor_cfg.get('agents') or {}).get(agent_name, {}).get('role','(unspecified role)')}.\n\n"
        f"Repository root on disk: {repo_root}\n"
        f"Task file path: {task_file}\n\n"
        "Instructions:\n"
        "1. Read the task file (it is the source of truth for scope, run-report, and attach-pack requirements).\n"
        "2. Work directly in the repository under the given root path.\n"
        "3. Before coding, perform the Pre-Run Ritual. Respect lock protocol and scope_paths.\n"
        "4. When finished, ensure all required tests/checks are executed and documented in the run report.\n"
        "5. Package the Orchestrator Attach Pack under docs/orchestrator/from-agents/<agent>/.\n"
    )

    cmd = [cli_cmd, "-p", prompt, "--model", model]
    print(
        "[run-next] About to run Cursor Agent CLI (non-interactive): "
        f"{cli_cmd} -p \"[task instructions]\" --model {model}"
    )

    import subprocess
    try:
        subprocess.run(cmd, cwd=str(repo_root), check=False, env=os.environ.copy())
    except FileNotFoundError:
        print(
            "[run-next] ERROR: `cursor-agent` CLI not found on PATH.\n"
            "Install it from https://cursor.com/docs/cli/overview and ensure `cursor-agent --version` works."
        )


def cmd_status(args: argparse.Namespace) -> None:
    repo_root = resolve_repo_root(args.root)
    queue_path = repo_root / "ops" / "queue.jsonl"
    if not queue_path.exists():
        print("Queue not found; run init and plan.")
        return
    lines = [l for l in queue_path.read_text(encoding="utf-8").splitlines() if l.strip()]
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
    repo_root = resolve_repo_root(args.root)
    print(f"[root] Using repository root: {repo_root}")
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
    json_path.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8")

    md_path = docs_root / "FILE_INDEX.md"
    lines = ["# File Index\n", "_Generated; do not edit manually._\n"]
    for e in entries:
        lines.append(f"- `{e['path']}` — {e['description'] or '(no summary)'}")
    md_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"[index-files] Wrote {len(entries)} entries to {json_path} and {md_path}")


# ------------------------------------------------------------------------------
# CLI
# ------------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="RastUp Orchestrator CLI")
    parser.add_argument(
        "--root",
        dest="root",
        default=None,
        help="Repository root override (defaults to $RASTUP_REPO_ROOT or project root).",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="Initialise ops/ and docs/ structure.")
    sub.add_parser("ingest-blueprints", help="Convert + index the two big project plans.")
    sub.add_parser("plan", help="Generate WBS, queue.jsonl, and TODO_MASTER.md from blueprint index.")
    sub.add_parser("run-next", help="Pop next queue item and dispatch to Cursor agent.")
    sub.add_parser("status", help="Print high-level queue status.")

    index_parser = sub.add_parser("index-files", help="Build the file/directory map from the repo.")
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
