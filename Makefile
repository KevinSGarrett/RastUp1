# -------- Make variables --------
SHELL := /bin/bash

PY ?= python
NODE ?= node
PLAYWRIGHT ?= npx playwright

# Orchestrator knobs (safe defaults; override at call time if desired)
ORCHESTRATOR_AUTOPILOT_MAX_LOOPS ?= 100
ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS ?= 10

# Node test directories (these exist in this repo)
NODE_TEST_DIRS := tests/frontend tests/booking tests/search tests/docs

.PHONY: help ci test test-python test-node test-e2e typecheck \
        infra-preflight infra-smoke infra-rotation-report \
        install-playwright playwright-report clean \
        autopilot autopilot-log run-next assistant-manager-anthropic \
        node-install-root node-install-web node-install \
        web-typecheck web-build review-latest

# Basic help
help:
	@echo "Targets:"
	@echo "  make ci                      # node-install + typecheck + unit tests (Python & Node) + infra checks"
	@echo "  make node-install            # install Node deps for root + web/"
	@echo "  make test                    # aggregate tests"
	@echo "  make test-python             # Python unit tests"
	@echo "  make test-node               # Node tests"
	@echo "  make typecheck               # TypeScript type-check (root + web/; no emit)"
	@echo "  make web-typecheck           # TypeScript type-check for web/ (Next.js app)"
	@echo "  make web-build               # Next.js production build for web/ (lint disabled)"
	@echo "  make infra-preflight         # run infrastructure preflight checks"
	@echo "  make infra-smoke             # run preflight + supplemental guardrails"
	@echo "  make infra-rotation-report   # summarise rotation coverage"
	@echo "  make test-e2e                # Playwright E2E tests"
	@echo "  make install-playwright      # Install Playwright deps"
	@echo "  make autoplay                # (alias: autopilot) run orchestrator loop"
	@echo "  make autoplay-log            # (alias: autopilot-log) tail logs"
	@echo "  make run-next                # run a single orchestrator iteration"
	@echo "  make assistant-manager-anthropic  # run-next with Anthropic manager"
	@echo "  make review-latest           # review latest agent run report"
	@echo "  make clean                   # clean caches/reports"

# Run full CI: install Node deps + type-check + unit tests (Python & Node) + infra guardrails.
# E2E is optional; enable by running: make ci RUN_E2E=1
ci: node-install typecheck test infra-preflight infra-smoke
ifdef RUN_E2E
	$(MAKE) test-e2e
endif
	@echo "CI suite completed."

# Aggregate tests
test: test-python test-node

# Python tests:
# - docs & schema tests live under tests/python/*
# - search tests live under tests/search/*
test-python:
	@set -e; \
	for d in tests/python tests/search; do \
	  if [ -d $$d ]; then \
	    echo ">>> Running Python tests in $$d"; \
	    $(PY) -m unittest discover -s $$d -p "test_*.py" -v; \
	  fi; \
	done

# Node tests:
# We run Node's built-in test runner recursively in the known test dirs.
test-node:
	@set -e; \
	found=0; \
	for d in $(NODE_TEST_DIRS); do \
	  if [ -d $$d ]; then \
	    found=1; \
	    echo ">>> Running Node tests in $$d"; \
	    tests=$$(find $$d -type f \( -name "*.test.mjs" -o -name "*.test.js" -o -name "*.test.ts" \)); \
	    if [ -n "$$tests" ]; then \
	      $(NODE) --test $$tests; \
	    else \
	      $(NODE) --test $$d; \
	    fi; \
	  fi; \
	done; \
	if [ $$found -eq 0 ]; then \
	  echo "No Node test directories found."; \
	fi

# -------- Node dependency install helpers --------

# Install root Node deps (only if node_modules is missing)
node-install-root:
	@if [ -f package-lock.json ]; then \
	  if [ ! -d node_modules ]; then \
	    echo ">>> Installing root Node deps (npm ci)"; \
	    npm ci; \
	  else \
	    echo ">>> Root node_modules already present; skipping npm ci"; \
	  fi; \
	else \
	  echo ">>> No package-lock.json in repo root; skipping root npm ci"; \
	fi

# Install web/ Node deps (only if web/node_modules is missing)
node-install-web:
	@if [ -d web ] && [ -f web/package-lock.json ]; then \
	  if [ ! -d web/node_modules ]; then \
	    echo ">>> Installing web/ Node deps (npm ci)"; \
	    cd web && npm ci; \
	  else \
	    echo ">>> web/node_modules already present; skipping npm ci"; \
	  fi; \
	else \
	  echo ">>> No web/ directory or web/package-lock.json; skipping web npm ci"; \
	fi

# Install Node deps for both root and web/
node-install: node-install-root node-install-web

# -------- TypeScript / web helpers --------

# TypeScript type checking across the repo (no emit)
# - Root: tsconfig.ci.json
# - Web app: web/tsconfig.json
typecheck:
	npx -y tsc --noEmit -p tsconfig.ci.json
	$(MAKE) web-typecheck

# Type-check the Next.js app under web/
web-typecheck:
	@if [ -d web ]; then \
	  cd web && npx -y tsc --noEmit -p tsconfig.json; \
	else \
	  echo ">>> No web/ directory; skipping web typecheck"; \
	fi

# Next.js production build (lint disabled; useful once layouts/routes are wired)
web-build:
	@if [ -d web ]; then \
	  cd web && npx next build --no-lint; \
	else \
	  echo ">>> No web/ directory; skipping web build"; \
	fi

# -------- Infrastructure guardrail helpers --------

infra-preflight:
	$(PY) -m tools.infra.preflight --format text

infra-smoke:
	$(PY) -m tools.infra.smoke --format text

infra-rotation-report:
	$(PY) -m tools.infra.rotation_report --format text

# -------- Playwright / E2E helpers --------

# Playwright E2E tests (expects config at playwright.config.ts)
test-e2e:
	$(PLAYWRIGHT) test

# One-time Playwright browser/deps install (needed on fresh machines/containers)
install-playwright:
	$(PLAYWRIGHT) install --with-deps

# Open the last Playwright HTML report
playwright-report:
	$(PLAYWRIGHT) show-report

# -------- Orchestrator helpers (optional) --------

# Run the autopilot loop with logs (matches the way you've been invoking it)
autopilot:
	mkdir -p logs
	ORCHESTRATOR_AUTOPILOT_MAX_LOOPS=$(ORCHESTRATOR_AUTOPILOT_MAX_LOOPS) \
	ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS=$(ORCHESTRATOR_AUTOPILOT_SLEEP_SECONDS) \
	$(PY) -m orchestrator.autopilot_loop | tee -a logs/autopilot.log

# Tail the autopilot log if present
autopilot-log:
	@if [ -f logs/autopilot.log ]; then \
		echo "Tailing logs/autopilot.log (Ctrl-C to stop)"; \
		tail -f logs/autopilot.log; \
	else \
		echo "No log file yet (logs/autopilot.log). Run 'make autopilot' first."; \
	fi

# Tail a single "run next" iteration (useful when queue has work)
run-next:
	$(PY) -m orchestrator.cli run-next

# If you want to run the next task with Anthropic as “assistant manager”,
# export ANTHROPIC_API_KEY first. The orchestrator will read the env and
# route accordingly if configured to honor ASSISTANT_MANAGER.
assistant-manager-anthropic:
	ANTHROPIC_API_KEY=$$ANTHROPIC_API_KEY \
	ASSISTANT_MANAGER=anthropic \
	$(PY) -m orchestrator.cli run-next

# Cleanup caches/reports (safe to skip)
clean:
	rm -rf .pytest_cache .cache .tsbuildinfo playwright-report test-results

# Review the latest agent run report using the orchestrator helper.
# Tries orchestrator.review_latest first, then falls back to the older name.
review-latest:
	@$(PY) -m orchestrator.review_latest || $(PY) -m orchestrator.reviewer
