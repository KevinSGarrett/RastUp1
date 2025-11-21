# orchestrator/cli.py
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, UTC
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

# NOTE: keep imports that pull heavy SDKs LAZY (inside functions),
# so that simple commands like `init` or `status` don't fail if
# anthropic/openai aren't installed yet.
from . import blueprints  # lightweight


def _resolve_root(explicit: Optional[str]) -> Path:
    """
    Resolve the project root in this exact order:
      1) --root argument
      2) $RASTUP_REPO_ROOT environment variable
      3) repo folder of this package (…/orchestrator/..)
    """
    if explicit:
        return Path(explicit).resolve()
    env = os.getenv("RASTUP_REPO_ROOT")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parent.parent


def _default_config(repo_root: Path) -> Dict[str, Any]:
    return {
        "local_root_path": str(repo_root),
        "blueprints": {
            "non_tech": "ProjectPlans/Combined_Master_PLAIN_Non_Tech_001.docx",
            "tech": "ProjectPlans/TechnicalDevelopmentPlan.odt",
        },
        "models": {
            # orchestrator (OpenAI/Anthropic) defaults; Cursor models are chosen per-task below
            "openai_model": "gpt-4.1-mini",
            "embedding_model": "text-embedding-3-large",
            "anthropic_model": None,
        },
        "cursor": {
            "cli_command": "cursor-agent",  # CLI agent (not GUI)
            "project_root": str(repo_root),
            # default Cursor model if the orchestrator can't decide (rare)
            "default_model": "gpt-5",
            # Agent roles remain documented; model selection is made by the orchestrator at runtime.
            "agents": {
                "AGENT-1": {"role": "Bootstrap & DevOps"},
                "AGENT-2": {"role": "Backend & Services"},
                "AGENT-3": {"role": "Frontend & Developer Experience"},
                "AGENT-4": {"role": "QA / Security / Docs / Release"},
            },
        },
    }


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
            f"- Status: initialised\n"
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
    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}

    # 🔧 Auto-patch old configs that still use the GUI 'cursor' launcher
    cursor_cfg = cfg.get("cursor") or {}
    cli_cmd = cursor_cfg.get("cli_command")
    if cli_cmd == "cursor":
        cursor_cfg["cli_command"] = "cursor-agent"
        cfg["cursor"] = cursor_cfg
        config_path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
        print(f"[config] Updated cursor.cli_command from 'cursor' to 'cursor-agent' in {config_path}")

    return cfg


# --- Lazy LLM imports ---------------------------------------------------------

def _make_llm(config: Dict[str, Any]):
    try:
        from .llm_client import LLMClient, LLMConfig  # lazy import to avoid hard deps early
    except Exception as e:
        raise SystemExit(
            f"[llm] Missing SDKs. Inside your venv run: pip install openai anthropic pyyaml\n(cause: {e})"
        )
    models = config.get("models", {})
    cfg = LLMConfig(
        openai_model=models.get("openai_model", "gpt-4.1-mini"),
        embedding_model=models.get("embedding_model", "text-embedding-3-large"),
        anthropic_model=models.get("anthropic_model"),
    )
    return LLMClient(cfg)


# --- Commands -----------------------------------------------------------------

def cmd_init(args: argparse.Namespace) -> None:
    repo_root = _resolve_root(args.root)
    ensure_basic_layout(repo_root)


def cmd_ingest_blueprints(args: argparse.Namespace) -> None:
    repo_root = _resolve_root(args.root)
    cfg = load_config(repo_root)
    llm = _make_llm(cfg)
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
    """Lightweight sanity check: index exists + counts."""
    repo_root = _resolve_root(args.root)
    index = repo_root / "docs" / "blueprints" / "blueprint_index.json"
    if not index.exists():
        raise SystemExit(f"[verify-blueprints] index missing: {index}")
    meta, _ = blueprints.load_blueprint_index(repo_root)
    nt = sum(1 for r in meta if r.get("doc_type") == "non-tech")
    td = sum(1 for r in meta if r.get("doc_type") == "tech")
    print(f"[verify-blueprints] OK — total={len(meta)} (non-tech={nt}, tech={td}) at {index}")


def _summaries_block(meta: List[Dict[str, Any]]) -> str:
    lines: List[str] = []
    for row in meta:
        summary = row.get("summary") or ""
        lines.append(f"{row['id']} ({row['doc_type']}): {summary}")
    return "\n".join(lines)


def cmd_plan(args: argparse.Namespace) -> None:
    repo_root = _resolve_root(args.root)
    cfg = load_config(repo_root)
    llm = _make_llm(cfg)
    meta, _ = blueprints.load_blueprint_index(repo_root)

    system = (
        "You are a senior engineering program manager for a very large multi-month build. "
        "You are given technical and non-technical blueprint fragments. "
        "Your job is to construct a Work Breakdown Structure (WBS) and an execution queue for "
        "four Cursor agents (AGENT-1..4). Output pure JSON only."
    )

    user = (
        "You will receive a list of blueprint chunks: `ID (doc_type): summary`.\n"
        "Build implementation order (not document order). Include tasks for docs/runbooks, "
        "orchestrator improvements, token discipline, per-agent prompts, recurring meta-QA, and usage/cost tracking.\n\n"
        "Output JSON only in the shape described. Now here are the blueprint chunk summaries:\n\n"
        f"{_summaries_block(meta)}"
    )

    raw = llm.chat_openai(
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": user}],
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
                "created_at": datetime.now(UTC).).isoformat().replace("+00:00","Z"),
                "blueprint_ids": t.get("blueprint_ids", []),
                "title": t.get("title", ""),
                "phase": t.get("phase", ""),
                "depends_on": t.get("depends_on", []),
                "acceptance_criteria": t.get("acceptance_criteria", []),
                "priority": i + 1,
            }
            f.write(json.dumps(queue_item, ensure_ascii=False) + "\n")
    print(f"[plan] Wrote queue items to {queue_path}")

    # human-readable
    todo_path = repo_root / "docs" / "TODO_MASTER.md"
    lines_out: List[str] = [
        "# Orchestrator To-Do List\n",
        "_This file is generated from ops/queue.jsonl. Do not edit manually._\n",
    ]
    # read back and group
    queue_items: List[Dict[str, Any]] = []
    with queue_path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                queue_items.append(json.loads(line))
    queue_items.sort(key=lambda q: (q.get("phase", ""), q["agent"], q["priority"]))
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


def _choose_cursor_model_for_task(llm, agent_name: str, wbs_task: Dict[str, Any], cfg: Dict[str, Any]) -> Tuple[str, bool]:
    """
    Orchestrator chooses Cursor model (not hard-coded).
    Returns: (model_string, max_mode_flag)
    """
    allowed = [
        "gpt-5-codex",
        "gpt-5",
        "claude-4.5-sonnet",
        "claude-4.5-haiku",
    ]
    # brief, cheap decision via OpenAI; fall back to a heuristic if anything fails.
    try:
        title = wbs_task.get("title", "")
        phase = wbs_task.get("phase", "")
        desc = (wbs_task.get("description") or "")[:600]
        prompt = (
            "Pick the single best Cursor model for the task below. "
            "Respond with pure JSON {\"model\":\"<one>\", \"max\": true|false}. "
            f"Allowed: {allowed}.\n"
            f"Agent: {agent_name}\nPhase: {phase}\nTitle: {title}\nDesc: {desc}"
        )
        raw = llm.chat_openai(
            messages=[{"role": "system", "content": "You choose the model for a Cursor agent."},
                      {"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=64,
        )
        data = json.loads(raw)
        model = data.get("model")
        max_flag = bool(data.get("max"))
        if model in allowed:
            return model, max_flag
    except Exception:
        pass

    # fallback heuristic
    phase = (wbs_task.get("phase") or "").lower()
    if "qa" in phase or "docs" in phase:
        return "claude-4.5-sonnet", True
    if "frontend" in phase:
        return "gpt-5-codex", True
    if "backend" in phase or "service" in phase:
        return "gpt-5-codex", True
    if "bootstrap" in phase or "ops" in phase:
        return "gpt-5-codex", True
    # ultimate fallback
    cur = cfg.get("cursor", {})
    return cur.get("default_model", "gpt-5"), True


def _build_task_file(
    repo_root: Path,
    wbs_task: Dict[str, Any],
    agent_name: str,
    llm,  # LLMClient
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
            blueprint_chunks.append(f"### {row['id']} ({sub})\n\n" + (row.get("text") or ""))

    bp_section = "\n\n".join(blueprint_chunks) if blueprint_chunks else "_No linked blueprint chunks._"

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
        f"{(wbs_task.get('description') or '')}\n\n"
        "### Acceptance Criteria\n\n"
    )
    for ac in wbs_task.get("acceptance_criteria", []) or []:
        content += f"- {ac}\n"
    if not wbs_task.get("acceptance_criteria"):
        content += "- (No explicit acceptance criteria provided.)\n"

    content += (
        "\n\n## Relevant Blueprint Chunks\n\n"
        f"{bp_section}\n\n"
        "## Pre-Run Ritual (HARD)\n\n"
        "- [ ] Read your last run report.\n"
        "- [ ] Read any related run reports for this WBS.\n"
        "- [ ] Summarise Plan vs Done vs Pending before coding.\n\n"
        "## Locking & Access (HARD)\n\n"
        f"- Acquire your lock at `ops/locks/{agent_name}.lock` before modifying files.\n"
        "- Declare your scope_paths[] in your run report.\n"
        "- If you detect overlapping scopes or foreign changes, STOP and hand back to the Orchestrator.\n\n"
        "## Required Run Report Content (HARD)\n\n"
        "- Context snapshot (WBS/blueprint IDs).\n"
        "- What Was Done vs Planned; How it was done.\n"
        "- Testing (commands, results, coverage, security scans) + 'Testing Proof'.\n"
        "- Locations / Touch Map (files created/modified/removed).\n"
        "- Suggestions for Next Agents; Progress & checklist.\n\n"
        "## Orchestrator Attach Pack (HARD)\n\n"
        "- Place under `docs/orchestrator/from-agents/"
        f"{agent_name}/run-<timestamp>-attach.zip`.\n"
        "- Include: run report, diff summary, CI/test artifacts, perf/security results,\n"
        "  and a manifest.json (agent, run_id, wbs_ids, blueprint_ids, status).\n\n"
        "## Testing (HARD)\n\n"
        "- Define a test plan before coding; implement unit/integration/E2E tests as appropriate.\n"
        "- Record all test commands and results in the run report.\n"
        "- If tests are incomplete, mark the task partial and propose follow-ups.\n\n"
        "## Implementation Notes\n\n"
        "(Use this space during your run.)\n\n"
        "## Issues & Risks\n\n"
        "(Document issues/risks.)\n\n"
        "## Suggestions for Next Agents\n\n"
        "(Guidance for follow-up work.)\n"
    )

    task_root = repo_root / "ops" / "tasks" / agent_name
    task_root.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%SZ")
    task_path = task_root / f"{wbs_task['id']}-{ts}.md"
    task_path.write_text(content, encoding="utf-8")
    return task_path


def cmd_run_next(args: argparse.Namespace) -> None:
    repo_root = _resolve_root(args.root)
    cfg = load_config(repo_root)
    llm = _make_llm(cfg)
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
    # orchestrator decides Cursor model (not hard-coded)
    model, max_flag = _choose_cursor_model_for_task(llm, agent_name, wbs_task, cfg)
    if max_flag:
        # MAX toggle is a Cursor UX feature; include it in the prompt explicitly
        max_note = " (MAX mode enabled)"
    else:
        max_note = ""

    task_file = _build_task_file(repo_root, wbs_task, agent_name, llm)
    print(f"[run-next] Created task file for {agent_name}: {task_file}")

    cursor_cfg = cfg.get("cursor", {})
    cli_cmd = (cursor_cfg.get("cli_command") or "cursor-agent").strip()
    if cli_cmd == "cursor":
        cli_cmd = "cursor-agent"

    # Non-interactive CLI prompt; agent reads the task file path
    prompt = (
        f"You are {agent_name}, a Cursor CLI agent.\n"
        f"Repository root on disk: {repo_root}\n"
        f"Task file path: {task_file}\n\n"
        "Instructions:\n"
        "1) Read the task file and follow it exactly.\n"
        "2) Work in the repository root above; obey locking & run-report rules.\n"
        "3) When finished, ensure tests/CI and attach-pack are produced as specified."
    )
    cmd = [cli_cmd, "-p", prompt, "--model", model, "--force"]
    print(
        "[run-next] About to run Cursor Agent CLI (non-interactive): "
        f"{cli_cmd} -p \"[task instructions]\" --model {model}{max_note} --force"
    )

    import subprocess
    try:
        subprocess.run(cmd, cwd=str(repo_root), check=False)
    except FileNotFoundError:
        print(
            "[run-next] ERROR: `cursor-agent` CLI not found on PATH.\n"
            "Install it from https://cursor.com/docs/cli/overview and ensure `cursor-agent --version` works."
        )


def cmd_status(args: argparse.Namespace) -> None:
    repo_root = _resolve_root(args.root)
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


def _task_has_run_report(repo_root: Path, task_id: str) -> bool:
    runs_root = repo_root / "docs" / "runs"
    if not runs_root.exists():
        return False
    needle = task_id
    for p in runs_root.rglob("*.md"):
        if needle in p.name or needle in p.read_text(encoding="utf-8", errors="ignore"):
            return True
    return False


def cmd_sweep_inprogress(args: argparse.Namespace) -> None:
    """
    If in-progress tasks have no run report, reset them to todo so autopilot can proceed.
    This mirrors what your autopilot log was doing with a manual sweep.  :contentReference[oaicite:2]{index=2}
    """
    repo_root = _resolve_root(args.root)
    queue_path = repo_root / "ops" / "queue.jsonl"
    if not queue_path.exists():
        print("[sweep-inprogress] No queue.jsonl found.")
        return
    items: List[Dict[str, Any]] = []
    with queue_path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                items.append(json.loads(line))
    changed = False
    for it in items:
        if it.get("status") == "in_progress":
            tid = it["task_id"]
            if not _task_has_run_report(repo_root, tid):
                print(f"[sweep-inprogress] No run report for {tid}; setting status -> todo")
                it["status"] = "todo"
                changed = True
    if changed:
        with queue_path.open("w", encoding="utf-8") as f:
            for it in items:
                f.write(json.dumps(it, ensure_ascii=False) + "\n")
        print("[sweep-inprogress] Updated queue.jsonl")
    else:
        print("[sweep-inprogress] No changes required.")


def cmd_index_files(args: argparse.Namespace) -> None:
    repo_root = _resolve_root(args.root)
    cfg = load_config(repo_root)
    llm = _make_llm(cfg)

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
                        {"role": "user", "content":
                            "Summarise what this file does in 1–3 short sentences, "
                            "including its main responsibilities and how it fits into a larger system.\n\n"
                            f"FILE PATH: {rel}\n\nCONTENT SNIPPET:\n{snippet}"
                        },
                    ],
                    temperature=0.2,
                    max_tokens=180,
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


def main() -> None:
    parser = argparse.ArgumentParser(description="RastUp Orchestrator CLI")
    parser.add_argument("--root", help="Project root (or set RASTUP_REPO_ROOT).", default=None)

    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="Initialise ops/ and docs/ structure.")
    sub.add_parser("ingest-blueprints", help="Convert + index the two big project plans.")
    sub.add_parser("verify-blueprints", help="Sanity check blueprint index exists + counts.")
    sub.add_parser("plan", help="Generate WBS, queue.jsonl, and TODO_MASTER.md from blueprint index.")
    sub.add_parser("run-next", help="Pop next queue item and dispatch to Cursor agent.")
    sub.add_parser("status", help="Print high-level queue status.")
    sub.add_parser("sweep-inprogress", help="Reset stuck in_progress items that have no run report.")

    index_parser = sub.add_parser("index-files", help="Build the file/directory map from the repo.")
    index_parser.add_argument("--max-files", type=int, default=None,
                              help="Optional limit on number of files to summarise.")

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
    elif args.command == "sweep-inprogress":
        cmd_sweep_inprogress(args)
    elif args.command == "index-files":
        cmd_index_files(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
