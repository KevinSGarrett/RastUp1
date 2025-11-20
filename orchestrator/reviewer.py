from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path
from datetime import datetime
from typing import Iterable, List, Tuple


# ---------- small helpers ----------

def _human_size(n: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    i = 0
    f = float(n)
    while f >= 1024 and i < len(units) - 1:
        f /= 1024.0
        i += 1
    return f"{f:.1f} {units[i]}" if i else f"{int(f)} {units[i]}"


def _sh(*cmd: str) -> tuple[int, str, str]:
    try:
        p = subprocess.run(cmd, text=True, capture_output=True, check=False)
        return p.returncode, (p.stdout or "").strip(), (p.stderr or "").strip()
    except FileNotFoundError:
        return 127, "", f"{cmd[0]} not found"


def _git_summary() -> list[str]:
    out: list[str] = []
    if not shutil.which("git"):
        out.append("git: not found")
        return out
    rc, inside, _ = _sh("git", "rev-parse", "--is-inside-work-tree")
    if rc != 0 or inside != "true":
        out.append("git: not a repository")
        return out

    rc, head, _ = _sh("git", "rev-parse", "--short", "HEAD")
    if rc == 0 and head:
        out.append(f"HEAD: {head}")

    rc, msg, _ = _sh("git", "log", "-1", "--pretty=%B")
    if rc == 0 and msg:
        out.append("Last commit message:")
        out.extend([f"    {line}" for line in msg.splitlines() if line.strip() != ""])

    rc, changed, _ = _sh("git", "show", "--name-status", "--pretty=", "-1")
    if rc == 0 and changed:
        out.append("Files changed in last commit:")
        for line in changed.splitlines():
            if line.strip():
                out.append(f"    {line}")
    return out


def _list_recent_files(
    roots: Iterable[Path], patterns: Iterable[str], limit: int
) -> list[tuple[float, Path, int]]:
    items: list[tuple[float, Path, int]] = []
    for root in roots:
        if not root.exists():
            continue
        for pat in patterns:
            for f in root.rglob(pat):
                try:
                    st = f.stat()
                except OSError:
                    continue
                items.append((st.st_mtime, f, st.st_size))
    items.sort(key=lambda t: t[0], reverse=True)
    return items[:limit]


def _node_version() -> str:
    if not shutil.which("node"):
        return "not found"
    rc, out, _ = _sh("node", "-v")
    return out or "unknown"


def _retry_helper_status() -> str:
    try:
        # optional; only to mirror your current output
        from orchestrator.cursor_agent import call_cursor_with_retry  # type: ignore

        _ = call_cursor_with_retry  # silence unused
        return "available (orchestrator.cursor_agent.call_cursor_with_retry)"
    except Exception:
        return "unavailable"


def _tail(path: Path, lines: int) -> list[str]:
    if not path.exists():
        return [f"(missing) {path}"]
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            buf = fh.readlines()
    except OSError as e:
        return [f"error reading {path}: {e}"]
    if lines < 0:
        return []
    return buf[-lines:]


# ---------- main program ----------

def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="orchestrator.reviewer",
        description="Print a quick environment/git summary and tail of the latest log.",
    )
    ap.add_argument(
        "--log",
        default="logs/autopilot.log",
        help="Path to the log file to tail (default: logs/autopilot.log)",
    )
    ap.add_argument(
        "--tail",
        type=int,
        default=120,
        help="Number of lines to tail (negative disables tail output). Default: 120",
    )
    ap.add_argument(
        "--recent-roots",
        nargs="*",
        default=["logs"],
        help="Roots to scan for 'Recent artifacts'. Default: logs",
    )
    ap.add_argument(
        "--recent-patterns",
        nargs="*",
        default=["*.log"],
        help="Glob patterns under roots for 'Recent artifacts'. Default: *.log",
    )
    ap.add_argument(
        "--recent-limit",
        type=int,
        default=5,
        help="Max number of 'Recent artifacts' to list. Default: 5",
    )
    args = ap.parse_args(argv)

    # Environment
    print("[reviewer] Environment")
    print(f"  python: {sys.version.split()[0]}")
    print(f"  node: {_node_version()}")
    print(f"  retry helper: {_retry_helper_status()}")

    # Git
    print("\n[reviewer] Git")
    for line in _git_summary() or ["(no git information available)"]:
        print(f"  {line}")

    # Recent artifacts
    roots = [Path(r) for r in args.recent_roots]
    pats = list(args.recent_patterns)
    items = _list_recent_files(roots, pats, args.recent_limit)
    print("\n[reviewer] Recent artifacts")
    if not items:
        joined_roots = ", ".join(str(r) for r in roots if r.exists()) or "(none)"
        print(f"  (none under {joined_roots})")
    else:
        for ts, path, size in items:
            dt = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
            print(f"  {dt}  {_human_size(size):>8}  {path.as_posix()}")

    # Tail
    log_path = Path(args.log)
    print(f"\n[reviewer] Tail ({'-' if args.tail >= 0 else ''}{args.tail}) of {log_path}")
    print("-" * 80)
    for line in _tail(log_path, args.tail):
        print(line.rstrip())
    print("-" * 80)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
