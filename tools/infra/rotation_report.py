"""Produce a rotation readiness report from the configuration registry."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Sequence

from . import common


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _rotation_bucket(value: str) -> str:
    normalized = value.replace("—", "").strip().lower()
    if normalized in common.ROTATION_OPTIONALS:
        return "n/a"
    if not normalized:
        return "unspecified"
    if "on-demand" in normalized or "on demand" in normalized:
        return "on-demand"
    if "90" in normalized:
        return "90d"
    if "180" in normalized:
        return "180d"
    if "30" in normalized:
        return "30d"
    if "quarter" in normalized:
        return "quarterly"
    if "annual" in normalized or "year" in normalized or "365" in normalized:
        return "annual"
    if "monthly" in normalized or "30d" in normalized:
        return "30d"
    return normalized


def generate_rotation_summary(
    entries: Sequence[common.RegistryEntry],
    include_all: bool = False,
) -> Dict[str, object]:
    buckets: Dict[str, List[str]] = defaultdict(list)
    unmanaged: List[str] = []

    for entry in entries:
        if entry.requires_rotation_policy() or include_all:
            bucket = _rotation_bucket(entry.rotation)
            if entry.requires_rotation_policy() and bucket == "n/a":
                # Surface as unmanaged when a policy is missing.
                unmanaged.append(entry.key)
            else:
                buckets[bucket].append(entry.key)

    for key in buckets:
        buckets[key].sort()

    managed_entries = sum(len(keys) for keys in buckets.values())
    summary = {
        "total_entries": len(entries),
        "managed_entries": managed_entries,
        "rotation_buckets": dict(sorted(buckets.items())),
    }

    if unmanaged:
        unmanaged.sort()
        summary["unmanaged"] = unmanaged

    return summary


def _format_text(summary: Dict[str, object]) -> str:
    lines = [
        f"Total registry entries: {summary['total_entries']}",
        f"Entries with rotation buckets: {summary['managed_entries']}",
    ]
    buckets = summary.get("rotation_buckets", {})
    if not buckets:
        lines.append("No rotation-managed entries detected.")
    else:
        lines.append("Rotation buckets:")
        for bucket, keys in buckets.items():
            lines.append(f"  - {bucket}: {len(keys)}")
            for key in keys:
                lines.append(f"      * {key}")
    unmanaged = summary.get("unmanaged", [])
    if unmanaged:
        lines.append("Entries lacking rotation policy:")
        for key in unmanaged:
            lines.append(f"  - {key}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Summarise rotation requirements from the configuration registry."
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Output format (default: text).",
    )
    parser.add_argument(
        "--include-all",
        action="store_true",
        help="Include non-managed (plain) entries in the rotation buckets.",
    )
    args = parser.parse_args()

    registry_path = _repo_root() / "ops" / "config" / "registry.md"
    entries = common.load_registry(registry_path)
    summary = generate_rotation_summary(entries, include_all=args.include_all)

    if args.format == "json":
        print(json.dumps(summary, indent=2))
    else:
        print(_format_text(summary))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
