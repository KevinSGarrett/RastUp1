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
        install-playwright playwright-report clean \
        autopilot autopilot-log run-next assistant-manager-anthropic

# Basic help
help:
	@echo "Targets:"
	@echo "  make ci                      # typecheck + unit tests (Python & Node)"
	@echo "  make test                    # aggregate tests"
	@echo "  make test-python             # Python unit tests"
	@echo "  make test-node               # Node tests"
	@echo "  make typecheck               # TypeScript type-check (no emit)"
	@echo "  make test-e2e                # Playwright E2E tests"
	@echo "  make install-playwright      # Install Playwright deps"
	@echo "  make autoplay                # (alias: autopilot) run orchestrator loop"
	@echo "  make autoplay-log            # (alias: autopilot-log) tail logs"
	@echo "  make run-next                # run a single orchestrator iteration"
	@echo "  make assistant-manager-anthropic  # run-next with Anthropic manager"
	@echo "  make clean                   # clean caches/reports"

# Run full CI: type-check + unit tests (Python & Node).
# E2E is optional; enable by running: make ci RUN_E2E=1
ci: typecheck test
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
	    $(NODE) --test $$d; \
	  fi; \
	done; \
	if [ $$found -eq 0 ]; then \
	  echo "No Node test directories found."; \
	fi

# TypeScript type checking across the repo (no emit)
typecheck:
	npx -y tsc --noEmit

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
