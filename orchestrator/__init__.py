# orchestrator/__init__.py

"""
RastUp Orchestrator package.

CLI entrypoint: python -m orchestrator.cli <command>

This package is the "boss" that:
- Ingests and indexes the two big blueprint docs
- Builds the WBS and queue.jsonl
- Dispatches tasks to Cursor agents via CLI
- Maintains basic state and documentation
"""
