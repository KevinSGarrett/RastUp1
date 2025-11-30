#!/usr/bin/env python3
"""
Validate event contract manifest integrity.

Usage:
    python tools/validate_event_contracts.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "docs" / "data" / "events" / "manifest.json"


class ValidationError(Exception):
    """Raised when validation fails."""


def sha256_for_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_manifest(manifest: dict) -> list[str]:
    problems: list[str] = []
    events = manifest.get("events", [])
    if not isinstance(events, list) or not events:
        problems.append("Manifest must contain at least one event entry.")
        return problems

    seen = set()
    for entry in events:
        if not isinstance(entry, dict):
            problems.append("Event entry is not an object.")
            continue

        event_name = entry.get("event_name")
        version = entry.get("version")

        if not event_name or not isinstance(event_name, str):
            problems.append("Event entry missing string event_name.")
            continue

        if not isinstance(version, int) or version <= 0:
            problems.append(f"{event_name}: version must be a positive integer.")
            continue

        if (event_name, version) in seen:
            problems.append(f"Duplicate manifest entry for {event_name} v{version}.")
            continue
        seen.add((event_name, version))

        schema_file = entry.get("schema_file")
        if not schema_file:
            problems.append(f"{event_name} v{version}: missing schema_file.")
            continue

        schema_path = MANIFEST_PATH.parent / schema_file
        if not schema_path.exists():
            problems.append(f"{event_name} v{version}: schema file {schema_file} not found.")
            continue

        expected_filename = f"{event_name}.v{version}.schema.json"
        if schema_file != expected_filename:
            problems.append(
                f"{event_name} v{version}: schema_file must be {expected_filename}, found {schema_file}."
            )

        expected_hash = entry.get("sha256")
        actual_hash = sha256_for_file(schema_path)
        if expected_hash != actual_hash:
            problems.append(
                f"{event_name} v{version}: checksum mismatch "
                f"(manifest {expected_hash}, actual {actual_hash})."
            )

        privacy_tier = entry.get("privacy_tier")
        if privacy_tier not in {"public", "tier1", "tier2", "restricted"}:
            problems.append(f"{event_name} v{version}: invalid privacy_tier {privacy_tier}.")

        retention_class = entry.get("retention_class")
        if not retention_class:
            problems.append(f"{event_name} v{version}: retention_class is required.")

        sha_value = entry.get("sha256")
        if not isinstance(sha_value, str) or len(sha_value) != 64 or any(ch not in "0123456789abcdef" for ch in sha_value.lower()):
            problems.append(f"{event_name} v{version}: sha256 must be a 64-character hex string.")

    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Validate event manifest integrity.")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=MANIFEST_PATH,
        help="Path to manifest.json (default: docs/data/events/manifest.json)",
    )
    args = parser.parse_args(argv)

    manifest_path: Path = args.manifest
    if not manifest_path.exists():
        print(f"[error] Manifest not found: {manifest_path}", file=sys.stderr)
        return 2

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"[error] Failed to decode manifest: {exc}", file=sys.stderr)
        return 2

    problems = validate_manifest(manifest)
    if problems:
        print("[fail] Event contract validation found issues:")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print(f"[ok] Manifest validated: {len(manifest['events'])} event(s) checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
