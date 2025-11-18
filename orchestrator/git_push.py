from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def git(*args: str) -> None:
    subprocess.run(["git", "-C", str(ROOT), *args], check=True)

def main() -> None:
    print("[orchestrator.git_push] git status:")
    git("status")
    print("[orchestrator.git_push] pushing...")
    git("push")

if __name__ == "__main__":
    main()
