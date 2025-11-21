# tools/index/check_index.py
import sys, yaml, glob, os
from pathlib import Path

idx = yaml.safe_load(Path("ops/index.yaml").read_text())
errors = []
for sec in idx.get("sections", []):
    for req in sec.get("required", []):
        matches = glob.glob(req)
        if not matches:
            errors.append(f"[{sec['id']}] missing: {req}")

for inv in idx.get("invariants", []):
    p = Path(inv["path"])
    if not p.exists():
        errors.append(f"[invariant] {p} missing")
        continue
    text = p.read_text(errors="ignore")
    for needle in inv.get("contains", []):
        if needle not in text:
            errors.append(f"[invariant] {p} missing token: {needle}")

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(2)
print("index OK")
