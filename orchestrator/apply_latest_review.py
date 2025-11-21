import os
import re
import subprocess

def _passes_ci():
    return subprocess.run(["make", "ci"], check=False).returncode == 0

def _has_run_report():
    if os.path.exists("docs/runs/latest.md"):
        return True
    d = "docs/runs"
    return os.path.isdir(d) and any(p.startswith("docs/runs/") for p in os.listdir(d))

_ACCEPT_RE = re.compile(r"^ACCEPTANCE:\s*(yes|no)\b", re.I | re.M)

def _acceptance_is_yes(report_text: str) -> bool:
    m = _ACCEPT_RE.search(report_text)
    return bool(m and m.group(1).lower() == "yes")

def gate_apply(report_path: str) -> bool:
    if not _has_run_report():
        return False
    if not _passes_ci():
        return False
    try:
        with open(report_path, "r", encoding="utf-8") as f:
            txt = f.read()
    except FileNotFoundError:
        return False
    return _acceptance_is_yes(txt)
