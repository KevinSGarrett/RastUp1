#!/usr/bin/env bash
# Strict + reliable
set -Eeuo pipefail

REPO="${1:-/mnt/c/RastUp1}"
cd "$REPO"

# Activate venv if present
if [ -f ".venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

mkdir -p logs

# Tuneable knobs (safe defaults; override by exporting before running)
: "${ORCHESTRATOR_AUTOPILOT_MAX_LOOPS:=1}"
: "${ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS:=10}"
export ORCHESTRATOR_AUTOPILOT_MAX_LOOPS ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS

# Hard preflight: fail if required tools/vars are missing
python - <<'PY'
import os, sys, shutil
errs = []

# Binaries we rely on
for bin_ in ("python", "node", "npm"):
    if not shutil.which(bin_):
        errs.append(f"Missing required binary: {bin_}")

# Require OpenAI; Anthropic is optional (we’ll disable by default)
if not os.getenv("OPENAI_API_KEY"):
    errs.append("Missing env var: OPENAI_API_KEY")

if errs:
    print("\nPRE-FLIGHT FAILED:")
    for e in errs: print(" -", e)
    sys.exit(1)
print("Pre-flight OK")
PY

# Allow forcing Anthropic off until it’s configured
: "${USE_ANTHROPIC:=0}"
export USE_ANTHROPIC

cleanup() { pkill -P $$ 2>/dev/null || true; }
trap cleanup INT TERM

# Run review loop and stream to both screen and log
python -m orchestrator.review_latest 2>&1 | tee -a logs/autopilot.log
